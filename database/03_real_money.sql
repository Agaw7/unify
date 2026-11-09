-- Apply after profiles exists. No sandbox balances are migrated.
begin;
create table public.money_customers (
 user_id uuid primary key references auth.users(id),
 verified boolean not null default false,
 blocked boolean not null default false,
 verification_reference text,
 updated_at timestamptz not null default now()
);
create table public.money_wallets (
 user_id uuid primary key references auth.users(id),
 available bigint not null default 0 check (available >= 0),
 reserved bigint not null default 0 check (reserved >= 0),
 currency text not null default 'PHP' check(currency = 'PHP')
);
create table public.money_destinations (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id),
 method text not null check(method in ('gcash','maya')),
 account_name text not null check(length(account_name) between 2 and 100),
 account_number text not null check(account_number ~ '^09[0-9]{9}$'),
 bic text,
 verified boolean not null default false,
 verification_reference text,
 created_at timestamptz not null default now()
);
create table public.money_transactions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id),
 kind text not null check(kind in ('deposit','withdrawal')),
 amount bigint not null check(amount between 10000 and 5000000),
 currency text not null default 'PHP' check(currency='PHP'),
 method text not null check(method in ('gcash','maya')),
 status text not null default 'pending' check(status in ('pending','creating','reserved','approved','processing','completed','rejected','failed')),
 idempotency_key uuid not null,
 provider_reference text unique,
 checkout_url text,
 destination_id uuid references public.money_destinations(id),
 destination_snapshot jsonb,
 reviewed_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(user_id,kind,idempotency_key)
);
create index money_transaction_history on public.money_transactions(user_id,created_at desc);
create table public.money_events (
 id text primary key,
 transaction_id uuid not null references public.money_transactions(id),
 created_at timestamptz not null default now()
);
create table public.money_ledger (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id),
 transaction_id uuid not null references public.money_transactions(id),
 action text not null,
 available_delta bigint not null,
 reserved_delta bigint not null,
 created_at timestamptz not null default now(),
 unique(transaction_id,action)
);
create table public.money_audit (
 id bigint generated always as identity primary key,
 actor_id uuid references auth.users(id),
 subject_id uuid,
 action text not null,
 details jsonb not null default '{}',
 created_at timestamptz not null default now()
);
-- Only service_role can mutate these tables or execute money RPCs.
do $$ declare t text; begin
 foreach t in array array['money_customers','money_wallets','money_destinations','money_transactions','money_events','money_ledger','money_audit'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon, authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
grant usage, select on sequence public.money_ledger_id_seq, public.money_audit_id_seq to service_role;

create function public.money_request(p_user uuid,p_kind text,p_amount bigint,p_method text,p_key uuid,p_destination uuid default null)
returns public.money_transactions language plpgsql security definer set search_path='' as $$
declare t public.money_transactions; d public.money_destinations; c public.money_customers;
begin
 -- Serialize requests and velocity checks per customer, including first-wallet creation.
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 select * into t from public.money_transactions where user_id=p_user and kind=p_kind and idempotency_key=p_key;
 if found then
  if t.amount<>p_amount or t.method<>p_method or t.destination_id is distinct from p_destination then raise exception 'Idempotency key conflict'; end if;
  return t;
 end if;
 select * into c from public.money_customers where user_id=p_user;
 if not found or not c.verified or c.blocked then raise exception 'Verified, unrestricted customer required'; end if;
 if p_kind not in ('deposit','withdrawal') or p_amount is null or p_amount<10000 or p_amount>5000000
    or p_method is null or p_method not in ('gcash','maya') or p_key is null then raise exception 'Invalid money request'; end if;
 if p_kind='deposit' and (p_amount<20000 or p_destination is not null) then raise exception 'Invalid deposit'; end if;
 if (select count(*) from public.money_transactions where user_id=p_user and created_at>now()-interval '1 hour')>=10 then raise exception 'Hourly request limit reached'; end if;
 if (select coalesce(sum(amount),0) from public.money_transactions where user_id=p_user and kind=p_kind and created_at>now()-interval '24 hours' and status not in ('rejected','failed'))+p_amount>10000000 then raise exception 'Daily amount limit reached'; end if;
 insert into public.money_wallets(user_id) values(p_user) on conflict do nothing;
 if p_kind='withdrawal' then
  select * into d from public.money_destinations where id=p_destination and user_id=p_user and verified for share;
  if not found or d.method<>p_method or d.bic is null then raise exception 'Verified destination required'; end if;
  update public.money_wallets set available=available-p_amount,reserved=reserved+p_amount where user_id=p_user and available>=p_amount;
  if not found then raise exception 'Insufficient available balance'; end if;
 end if;
 insert into public.money_transactions(user_id,kind,amount,method,idempotency_key,destination_id,destination_snapshot,status)
 values(p_user,p_kind,p_amount,p_method,p_key,p_destination,
 case when p_kind='withdrawal' then jsonb_build_object('number',d.account_number,'name',d.account_name,'bic',d.bic) end,
 case when p_kind='withdrawal' then 'reserved' else 'pending' end) returning * into t;
 if p_kind='withdrawal' then
  insert into public.money_ledger(user_id,transaction_id,action,available_delta,reserved_delta) values(p_user,t.id,'reserve',-p_amount,p_amount);
 end if;
 insert into public.money_audit(actor_id,subject_id,action) values(p_user,t.id,'request_'||p_kind);
 return t;
end $$;

create function public.money_credit(p_transaction uuid,p_checkout text,p_event text,p_amount bigint)
returns void language plpgsql security definer set search_path='' as $$
declare t public.money_transactions;
begin
 select * into strict t from public.money_transactions where id=p_transaction for update;
 if t.kind<>'deposit' or t.amount<>p_amount or t.provider_reference is distinct from p_checkout then raise exception 'Deposit mismatch'; end if;
 if exists(select 1 from public.money_events where id=p_event and transaction_id<>t.id) then raise exception 'Event conflict'; end if;
 if t.status='completed' then return; end if;
 if t.status not in ('creating','pending') then raise exception 'Invalid deposit state'; end if;
 insert into public.money_events(id,transaction_id) values(p_event,t.id);
 update public.money_wallets set available=available+t.amount where user_id=t.user_id;
 if not found then raise exception 'Wallet missing'; end if;
 update public.money_transactions set status='completed',updated_at=now() where id=t.id;
 insert into public.money_ledger(user_id,transaction_id,action,available_delta,reserved_delta) values(t.user_id,t.id,'deposit',t.amount,0);
 insert into public.money_audit(subject_id,action,details) values(t.id,'verified_deposit',jsonb_build_object('event',p_event,'checkout',p_checkout));
end $$;

create function public.money_review(p_id uuid,p_actor uuid,p_action text,p_reason text)
returns public.money_transactions language plpgsql security definer set search_path='' as $$
declare t public.money_transactions;
begin
 if not exists(select 1 from public.profiles where id=p_actor and role='admin') then raise exception 'Administrator required'; end if;
 if length(trim(coalesce(p_reason,'')))<5 then raise exception 'Review reason required'; end if;
 select * into strict t from public.money_transactions where id=p_id for update;
 if t.kind<>'withdrawal' or p_action not in ('approve','reject')
    or (p_action='approve' and t.status<>'reserved')
    or (p_action='reject' and t.status not in ('reserved','approved')) then raise exception 'Invalid review state'; end if;
 if t.user_id=p_actor then raise exception 'Cannot review own withdrawal'; end if;
 if p_action='reject' then
  update public.money_wallets set available=available+t.amount,reserved=reserved-t.amount where user_id=t.user_id;
  insert into public.money_ledger(user_id,transaction_id,action,available_delta,reserved_delta) values(t.user_id,t.id,'release',t.amount,-t.amount);
 end if;
 update public.money_transactions set status=case when p_action='approve' then 'approved' else 'rejected' end,reviewed_by=p_actor,updated_at=now() where id=t.id returning * into t;
 insert into public.money_audit(actor_id,subject_id,action,details) values(p_actor,t.id,p_action,jsonb_build_object('reason',p_reason));
 return t;
end $$;

create function public.money_settle(p_id uuid,p_reference text,p_status text)
returns void language plpgsql security definer set search_path='' as $$
declare t public.money_transactions;
begin
 select * into strict t from public.money_transactions where id=p_id for update;
 if t.kind<>'withdrawal' or t.provider_reference is distinct from p_reference or p_status not in ('succeeded','failed','pending') then raise exception 'Payout mismatch'; end if;
 if t.status in ('completed','failed') then
  if (t.status='completed' and p_status='succeeded') or (t.status='failed' and p_status='failed') then return; end if;
  raise exception 'Conflicting terminal payout status';
 end if;
 if t.status<>'processing' then raise exception 'Invalid payout state'; end if;
 if p_status='pending' then return; end if;
 update public.money_wallets set reserved=reserved-t.amount,available=available+case when p_status='failed' then t.amount else 0 end where user_id=t.user_id;
 update public.money_transactions set status=case when p_status='succeeded' then 'completed' else 'failed' end,updated_at=now() where id=t.id;
 insert into public.money_ledger(user_id,transaction_id,action,available_delta,reserved_delta) values(t.user_id,t.id,'settle',case when p_status='failed' then t.amount else 0 end,-t.amount);
 insert into public.money_audit(subject_id,action,details) values(t.id,'verified_payout',jsonb_build_object('reference',p_reference,'status',p_status));
end $$;

create function public.money_compliance(p_actor uuid,p_user uuid,p_verified boolean,p_blocked boolean,p_destination uuid,p_bic text,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 if not exists(select 1 from public.profiles where id=p_actor and role='admin') or p_actor=p_user then raise exception 'Independent administrator required'; end if;
 if length(trim(coalesce(p_reason,'')))<5 then raise exception 'Evidence reference required'; end if;
 if p_destination is null then
  insert into public.money_customers(user_id,verified,blocked,verification_reference) values(p_user,p_verified,p_blocked,p_reason)
  on conflict(user_id) do update set verified=excluded.verified,blocked=excluded.blocked,verification_reference=excluded.verification_reference,updated_at=now();
 else
  if p_verified and coalesce(p_bic,'')!~'^[A-Z0-9]{8}([A-Z0-9]{3})?$' then raise exception 'Verified institution BIC required'; end if;
  update public.money_destinations set verified=p_verified,bic=p_bic,verification_reference=p_reason where id=p_destination and user_id=p_user;
  if not found then raise exception 'Destination missing'; end if;
 end if;
 insert into public.money_audit(actor_id,subject_id,action,details) values(p_actor,coalesce(p_destination,p_user),'compliance_review',jsonb_build_object('verified',p_verified,'blocked',p_blocked,'evidence',p_reason));
end $$;

create function public.money_claim_payout(p_id uuid,p_actor uuid)
returns public.money_transactions language plpgsql security definer set search_path='' as $$
declare t public.money_transactions; customer uuid;
begin
 select user_id into strict customer from public.money_transactions where id=p_id;
 perform pg_advisory_xact_lock(hashtextextended(customer::text,0));
 select * into strict t from public.money_transactions where id=p_id for update;
 if not exists(select 1 from public.profiles where id=p_actor and role='admin') or t.user_id=p_actor or t.reviewed_by=p_actor then raise exception 'Independent payout administrator required'; end if;
 if t.kind<>'withdrawal' or t.status<>'approved' then raise exception 'Payout already claimed or not approved'; end if;
 if not exists(select 1 from public.money_customers where user_id=t.user_id and verified and not blocked)
 or not exists(select 1 from public.money_destinations where id=t.destination_id and verified) then raise exception 'Customer or destination restricted'; end if;
 update public.money_transactions set status='processing',updated_at=now() where id=t.id returning * into t;
 insert into public.money_audit(actor_id,subject_id,action) values(p_actor,t.id,'claim_payout');
 return t;
end $$;
revoke all on function public.money_claim_payout(uuid,uuid) from public,anon,authenticated;
grant execute on function public.money_claim_payout(uuid,uuid) to service_role;

-- Record server-side lifecycle changes, including ambiguous provider submissions.
create function public.money_log_transition() returns trigger language plpgsql security definer set search_path='' as $$
begin
 new.updated_at=now();
 insert into public.money_audit(subject_id,action,details)
 values(new.id,'transaction_transition',jsonb_build_object('from',old.status,'to',new.status,'provider_reference',new.provider_reference));
 return new;
end $$;
revoke all on function public.money_log_transition() from public,anon,authenticated;
create trigger money_transaction_transition before update on public.money_transactions for each row execute function public.money_log_transition();

revoke all on function public.money_request(uuid,text,bigint,text,uuid,uuid),public.money_credit(uuid,text,text,bigint),public.money_review(uuid,uuid,text,text),public.money_settle(uuid,text,text),public.money_compliance(uuid,uuid,boolean,boolean,uuid,text,text) from public,anon,authenticated;
grant execute on function public.money_request(uuid,text,bigint,text,uuid,uuid),public.money_credit(uuid,text,text,bigint),public.money_review(uuid,uuid,text,text),public.money_settle(uuid,text,text),public.money_compliance(uuid,uuid,boolean,boolean,uuid,text,text) to service_role;
commit;
