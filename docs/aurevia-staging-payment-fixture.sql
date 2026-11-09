-- Test fixture only. Run exclusively in AUREVIA Sandbox ylsbpfmuqgyeofangfdb.
-- Uses minimal synthetic application tables, never a production baseline.
begin;

do $guard$
begin
  if to_regclass('public.profiles') is null
    or to_regclass('public.investment_products') is not null
    or to_regclass('public.team_members') is not null
    or not exists (select 1 from pg_attribute where attrelid=to_regclass('public.profiles') and attname='id' and atttypid='uuid'::regtype and not attisdropped)
    or not exists (select 1 from pg_attribute where attrelid=to_regclass('public.profiles') and attname='role' and atttypid='text'::regtype and not attisdropped)
    or to_regclass('public.money_transactions') is not null
    or (select count(*) from storage.buckets where id in ('manual-deposit-receipts','withdrawal-payout-proofs') and not public) <> 2
    or (select count(*) from pg_policies where schemaname='storage' and tablename='objects'
      and policyname in ('Deny client access to payout proof images','Deny client access to manual deposit receipts')) <> 2
  then raise exception 'Expected AUREVIA Sandbox with compatible profiles, both private proof buckets and policies, and no payment fixture tables'; end if;
end $guard$;
create table public.investment_products(id uuid primary key,name text,price numeric,daily_income numeric);
create table public.team_members(id uuid primary key,invited_by uuid,created_at timestamptz default now());
alter table public.investment_products enable row level security;
alter table public.team_members enable row level security;
revoke all on public.investment_products,public.team_members from anon,authenticated;
grant select on public.investment_products,public.team_members to service_role;
-- Apply after profiles exists. No sandbox balances are migrated.

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

-- Apply once AFTER 03_real_money.sql. Integer centavos throughout.

alter table public.money_wallets add column held bigint not null default 0 check(held>=0), add column debt bigint not null default 0 check(debt>=0);
alter table public.money_ledger add column held_delta bigint not null default 0, add column debt_delta bigint not null default 0;
alter table public.money_transactions add column payment_id text unique, add column last_checked_at timestamptz;
create table public.money_holds (
 transaction_id uuid primary key references public.money_transactions(id),
 remaining bigint not null check(remaining>=0),
 released boolean not null default false,
 settlement_reference text,
 released_at timestamptz
);
create table public.money_verifications (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
 destination_id uuid references public.money_destinations(id),
 kind text not null check(kind in ('identity','ownership')),
 status text not null default 'submitted' check(status in ('submitted','pending','approved','rejected','expired')),
 provider text, provider_reference text unique, evidence_reference text,
 reviewed_by uuid references auth.users(id), expires_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check((kind='identity' and destination_id is null) or (kind='ownership' and destination_id is not null))
);
create unique index money_verification_active on public.money_verifications(user_id,kind,coalesce(destination_id,'00000000-0000-0000-0000-000000000000'::uuid)) where status in ('submitted','pending','approved');
create table public.money_adjustments (
 id uuid primary key default gen_random_uuid(),transaction_id uuid not null references public.money_transactions(id),
 kind text not null check(kind in ('refund','dispute')),
 amount bigint not null check(amount>0),
 status text not null check(status in ('requested','submitting','pending','succeeded','failed','open','won','lost')),
 provider_reference text unique, idempotency_key uuid unique,
 held_part bigint not null default 0 check(held_part>=0),available_part bigint not null default 0 check(available_part>=0),
 shortfall bigint not null default 0 check(shortfall>=0),debt_remaining bigint not null default 0 check(debt_remaining>=0 and debt_remaining<=shortfall),
 reason text not null, created_by uuid references auth.users(id),
 last_provider_at bigint not null default 0,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(held_part+available_part+shortfall=amount)
);
create table public.money_alerts (
 key text primary key, transaction_id uuid references public.money_transactions(id),
 severity text not null check(severity in ('warning','critical')), message text not null,
 resolved boolean not null default false, created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.money_job_leases (name text primary key, token uuid not null, expires_at timestamptz not null);
do $$ declare t text; begin
 foreach t in array array['money_holds','money_verifications','money_adjustments','money_alerts','money_job_leases'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
-- The application service may append audit/ledger history, but cannot rewrite it.
revoke update,delete,truncate on public.money_ledger,public.money_audit,public.money_events from service_role;

-- Old verified flags alone cannot authorize new withdrawals or deposits.
create function public.money_customer_ready(p_user uuid,p_destination uuid default null) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.money_verifications where user_id=p_user and kind='identity' and status='approved' and expires_at>now())
 and (p_destination is null or exists(select 1 from public.money_verifications where user_id=p_user and destination_id=p_destination and kind='ownership' and status='approved' and expires_at>now()))
 and not exists(select 1 from public.money_adjustments a join public.money_transactions t on t.id=a.transaction_id where t.user_id=p_user and a.kind='dispute' and a.status='open')
 and not exists(select 1 from public.money_wallets where user_id=p_user and debt>0)
 and not exists(select 1 from public.money_alerts a left join public.money_transactions t on t.id=a.transaction_id where not a.resolved and a.severity='critical' and (a.transaction_id is null or t.user_id=p_user))
$$;
create function public.money_guard_transaction() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (tg_op='INSERT' or (new.kind='withdrawal' and new.status='processing' and old.status<>'processing'))
 and not public.money_customer_ready(new.user_id,new.destination_id) then raise exception 'Current identity/ownership approval required or account has a financial restriction'; end if;
 return new;
end $$;
create trigger money_transaction_eligibility before insert or update on public.money_transactions for each row execute function public.money_guard_transaction();

create function public.money_verification_decide(p_id uuid,p_actor uuid,p_status text,p_provider text,p_evidence text,p_expires timestamptz,p_bic text default null)
returns void language plpgsql security definer set search_path='' as $$
declare v public.money_verifications;
begin
 select * into strict v from public.money_verifications where id=p_id;
 perform pg_advisory_xact_lock(hashtextextended(v.user_id::text,0));
 select * into strict v from public.money_verifications where id=p_id for update;
 if not exists(select 1 from public.profiles where id=p_actor and role='admin') or p_actor=v.user_id then raise exception 'Independent administrator required'; end if;
 if p_status is null or p_status not in ('approved','rejected','expired') or length(trim(coalesce(p_provider,'')))<2 or length(trim(coalesce(p_evidence,'')))<5 then raise exception 'Provider and evidence required'; end if;
 if p_status='approved' and (p_expires is null or p_expires<=now() or p_expires>now()+interval '1 year') then raise exception 'Valid verification expiry required'; end if;
 if v.kind='ownership' and p_status='approved' and coalesce(p_bic,'')!~'^[A-Z0-9]{8}([A-Z0-9]{3})?$' then raise exception 'Verified BIC required'; end if;
 update public.money_verifications set status=p_status,provider=p_provider,evidence_reference=p_evidence,reviewed_by=p_actor,expires_at=p_expires,updated_at=now() where id=p_id;
 if v.kind='identity' then
  insert into public.money_customers(user_id,verified,verification_reference) values(v.user_id,p_status='approved',p_evidence)
  on conflict(user_id) do update set verified=excluded.verified,verification_reference=excluded.verification_reference,updated_at=now();
 else
  update public.money_destinations set verified=p_status='approved',bic=p_bic,verification_reference=p_evidence where id=v.destination_id and user_id=v.user_id;
 end if;
 insert into public.money_audit(actor_id,subject_id,action,details) values(p_actor,v.user_id,'verification_'||p_status,jsonb_build_object('verification_id',p_id,'provider',p_provider,'evidence',p_evidence));
end $$;

create or replace function public.money_credit(p_transaction uuid,p_checkout text,p_event text,p_amount bigint)
returns void language plpgsql security definer set search_path='' as $$
declare t public.money_transactions; u uuid;
begin
 select user_id into strict u from public.money_transactions where id=p_transaction;
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select * into strict t from public.money_transactions where id=p_transaction for update;
 if t.kind<>'deposit' or t.amount<>p_amount or t.provider_reference is distinct from p_checkout then raise exception 'Deposit mismatch'; end if;
 if exists(select 1 from public.money_events where id=p_event and transaction_id<>t.id) then raise exception 'Event conflict'; end if;
 if t.status='completed' then return; end if;
 if t.status not in ('creating','pending') then raise exception 'Invalid deposit state'; end if;
 insert into public.money_events(id,transaction_id) values(p_event,t.id);
 update public.money_wallets set held=held+t.amount where user_id=t.user_id;
 if not found then raise exception 'Wallet missing'; end if;
 insert into public.money_holds(transaction_id,remaining) values(t.id,t.amount);
 update public.money_transactions set status='completed',updated_at=now() where id=t.id;
 insert into public.money_ledger(user_id,transaction_id,action,available_delta,reserved_delta,held_delta) values(t.user_id,t.id,'deposit',0,0,t.amount);
 insert into public.money_audit(subject_id,action,details) values(t.id,'verified_deposit_held',jsonb_build_object('event',p_event,'checkout',p_checkout));
end $$;

create function public.money_release_hold(p_id uuid,p_actor uuid,p_evidence text)
returns void language plpgsql security definer set search_path='' as $$
declare t public.money_transactions; h public.money_holds; w public.money_wallets; repayment bigint; remaining_payment bigint; debt_row record; paid bigint;
begin
 select * into strict t from public.money_transactions where id=p_id;
 perform pg_advisory_xact_lock(hashtextextended(t.user_id::text,0));
 if not exists(select 1 from public.profiles where id=p_actor and role='admin') or p_actor=t.user_id then raise exception 'Independent administrator required'; end if;
 if length(trim(coalesce(p_evidence,'')))<5 then raise exception 'Settlement report evidence required'; end if;
 select * into strict h from public.money_holds where transaction_id=p_id for update;
 if h.released then return; end if;
 if exists(select 1 from public.money_adjustments where transaction_id=p_id and status in ('requested','submitting','pending','open')) then raise exception 'Active refund or dispute prevents release'; end if;
 if exists(select 1 from public.money_customers where user_id=t.user_id and blocked) then raise exception 'Restricted customer'; end if;
 if exists(select 1 from public.money_alerts a left join public.money_transactions mt on mt.id=a.transaction_id where not a.resolved and a.severity='critical' and (a.transaction_id is null or mt.user_id=t.user_id)) then raise exception 'Unresolved risk alert prevents settlement release'; end if;
 select * into strict w from public.money_wallets where user_id=t.user_id for update;
 repayment=least(w.debt,h.remaining);
 remaining_payment=repayment;
 for debt_row in select ma.id,ma.debt_remaining from public.money_adjustments ma join public.money_transactions mt on mt.id=ma.transaction_id where mt.user_id=t.user_id and ma.debt_remaining>0 order by ma.created_at,ma.id for update of ma loop
  paid=least(remaining_payment,debt_row.debt_remaining);
  update public.money_adjustments set debt_remaining=debt_remaining-paid where id=debt_row.id;
  remaining_payment=remaining_payment-paid;
  exit when remaining_payment=0;
 end loop;
 if remaining_payment<>0 then raise exception 'Debt ledger mismatch'; end if;
 update public.money_wallets set held=held-h.remaining,available=available+h.remaining-repayment,debt=debt-repayment where user_id=t.user_id;
 insert into public.money_ledger(user_id,transaction_id,action,available_delta,reserved_delta,held_delta,debt_delta) values(t.user_id,t.id,'settlement_release',h.remaining-repayment,0,-h.remaining,-repayment);
 update public.money_holds set remaining=0,released=true,released_at=now(),settlement_reference=p_evidence where transaction_id=t.id;
 insert into public.money_audit(actor_id,subject_id,action,details) values(p_actor,t.id,'settlement_release',jsonb_build_object('evidence',p_evidence));
end $$;

create function public.money_adjustment_open(p_id uuid,p_kind text,p_amount bigint,p_key uuid,p_reference text,p_actor uuid,p_reason text)
returns public.money_adjustments language plpgsql security definer set search_path='' as $$
declare t public.money_transactions; a public.money_adjustments; h public.money_holds; w public.money_wallets; hp bigint; ap bigint; gap bigint;
begin
 select * into strict t from public.money_transactions where id=p_id;
 perform pg_advisory_xact_lock(hashtextextended(t.user_id::text,0));
 select * into strict t from public.money_transactions where id=p_id for update;
 if p_key is not null then select * into a from public.money_adjustments where idempotency_key=p_key;
  if found then
   if a.transaction_id<>p_id or a.kind<>p_kind or a.amount<>p_amount then raise exception 'Idempotency key conflict'; end if;
   return a;
  end if;
 end if;
 if p_reference is not null then select * into a from public.money_adjustments where provider_reference=p_reference;
  if found then
   if a.transaction_id<>p_id or a.kind<>p_kind or a.amount<>p_amount then raise exception 'Adjustment mismatch'; end if;
   return a;
  end if;
 end if;
 if p_kind is null or p_kind not in ('refund','dispute') or p_amount is null or p_amount<1 or p_amount>t.amount or t.kind<>'deposit' or t.status<>'completed' or t.payment_id is null then raise exception 'Invalid adjustment'; end if;
 if p_reference is null and (p_actor is null or not exists(select 1 from public.profiles where id=p_actor and role='admin') or p_actor=t.user_id) then raise exception 'Independent administrator required'; end if;
 if length(trim(coalesce(p_reason,'')))<5 then raise exception 'Adjustment reason required'; end if;
 if p_kind='refund' and (select coalesce(sum(amount),0) from public.money_adjustments where transaction_id=t.id and kind='refund' and status<>'failed')+p_amount>t.amount then raise exception 'Refund exceeds remaining payment'; end if;
 if p_reference is null and exists(select 1 from public.money_adjustments where transaction_id=t.id and kind='dispute' and status in ('open','lost')) then raise exception 'Disputed payment cannot be refunded'; end if;
 select * into strict w from public.money_wallets where user_id=t.user_id for update;
 select * into h from public.money_holds where transaction_id=t.id for update;
 hp=least(coalesce(h.remaining,0),p_amount); ap=least(w.available,p_amount-hp);gap=p_amount-hp-ap;
 if p_reference is null and gap>0 then raise exception 'Insufficient refundable balance'; end if;
 insert into public.money_adjustments(transaction_id,kind,amount,status,provider_reference,idempotency_key,held_part,available_part,shortfall,debt_remaining,created_by,reason)
 values(t.id,p_kind,p_amount,case when p_kind='dispute' then 'open' when p_reference is null then 'requested' else 'pending' end,p_reference,p_key,hp,ap,gap,gap,p_actor,p_reason) returning * into a;
 update public.money_wallets set held=held-hp,available=available-ap,reserved=reserved+hp+ap,debt=debt+gap where user_id=t.user_id;
 update public.money_holds set remaining=remaining-hp where transaction_id=t.id;
 insert into public.money_ledger(user_id,transaction_id,action,available_delta,reserved_delta,held_delta,debt_delta) values(t.user_id,t.id,'adjustment_reserve:'||a.id,-ap,hp+ap,-hp,gap);
 insert into public.money_audit(actor_id,subject_id,action,details) values(p_actor,t.id,p_kind||'_opened',jsonb_build_object('adjustment',a.id,'amount',p_amount,'shortfall',gap));
 if gap>0 or p_kind='dispute' then
  insert into public.money_alerts(key,transaction_id,severity,message) values('adjustment:'||a.id,t.id,'critical','Refund/dispute requires review; withdrawals restricted while dispute or debt remains.') on conflict(key) do nothing;
 end if;
 return a;
end $$;

create function public.money_adjustment_finish(p_id uuid,p_reference text,p_status text,p_provider_at bigint)
returns void language plpgsql security definer set search_path='' as $$
declare a public.money_adjustments; t public.money_transactions; returning_funds boolean; hp bigint;
begin
 select t0.* into strict t from public.money_adjustments a0 join public.money_transactions t0 on t0.id=a0.transaction_id where a0.id=p_id;
 perform pg_advisory_xact_lock(hashtextextended(t.user_id::text,0));
 select * into strict a from public.money_adjustments where id=p_id for update;
 if a.provider_reference is distinct from p_reference or p_status is null or
 (a.kind='refund' and p_status not in ('pending','processing','succeeded','failed')) or (a.kind='dispute' and p_status not in ('open','won','lost')) then raise exception 'Adjustment mismatch'; end if;
 if a.status in ('succeeded','failed','won','lost') then
  if a.status=p_status then return; end if;
  if p_provider_at<=a.last_provider_at then return; end if;
  raise exception 'Conflicting terminal adjustment';
 end if;
 if p_provider_at<a.last_provider_at then return; end if;
 if p_status in ('pending','processing','open') then
  update public.money_adjustments set last_provider_at=p_provider_at,status=case when p_status='processing' then 'pending' else p_status end,updated_at=now() where id=a.id; return;
 end if;
 returning_funds=p_status in ('failed','won');
 -- Returned hold funds remain held even if the original deposit was released meanwhile.
 hp=case when returning_funds then a.held_part else 0 end;
 update public.money_wallets set reserved=reserved-a.held_part-a.available_part,
 available=available+case when returning_funds then a.available_part+a.shortfall-a.debt_remaining else 0 end,
 held=held+hp,debt=debt-case when returning_funds then a.debt_remaining else 0 end where user_id=t.user_id;
 if hp>0 then update public.money_holds set remaining=remaining+hp,released=false where transaction_id=t.id; end if;
 update public.money_adjustments set status=p_status,last_provider_at=p_provider_at,debt_remaining=case when returning_funds then 0 else debt_remaining end,updated_at=now() where id=a.id;
 insert into public.money_ledger(user_id,transaction_id,action,available_delta,reserved_delta,held_delta,debt_delta)
 values(t.user_id,t.id,'adjustment_finish:'||a.id,case when returning_funds then a.available_part+a.shortfall-a.debt_remaining else 0 end,-a.held_part-a.available_part,hp,case when returning_funds then -a.debt_remaining else 0 end);
 insert into public.money_audit(subject_id,action,details) values(t.id,'adjustment_'||p_status,jsonb_build_object('adjustment',a.id,'reference',p_reference));
 update public.money_alerts set resolved=true,updated_at=now() where key='adjustment:'||a.id and returning_funds;
end $$;

create function public.money_claim_refund(p_id uuid,p_actor uuid) returns public.money_adjustments
language plpgsql security definer set search_path='' as $$
declare a public.money_adjustments;
begin
 select * into strict a from public.money_adjustments where id=p_id for update;
 if not exists(select 1 from public.profiles where id=p_actor and role='admin') or a.created_by=p_actor then raise exception 'Independent refund sender required'; end if;
 if exists(select 1 from public.money_transactions where id=a.transaction_id and user_id=p_actor) then raise exception 'Cannot refund own payment'; end if;
 if a.kind<>'refund' or a.status<>'requested' then raise exception 'Refund already claimed'; end if;
 update public.money_adjustments set status='submitting',updated_at=now() where id=a.id returning * into a;
 insert into public.money_audit(actor_id,subject_id,action) values(p_actor,a.id,'refund_submitting'); return a;
end $$;

create function public.money_cancel_refund(p_id uuid,p_actor uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare a public.money_adjustments; u uuid;
begin
 select t.user_id into strict u from public.money_adjustments ma join public.money_transactions t on t.id=ma.transaction_id where ma.id=p_id;
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select * into strict a from public.money_adjustments where id=p_id for update;
 if not exists(select 1 from public.profiles where id=p_actor and role='admin') or u=p_actor or length(trim(coalesce(p_reason,'')))<5 then raise exception 'Independent administrator and evidence required'; end if;
 if a.kind<>'refund' or a.status<>'requested' or a.provider_reference is not null then raise exception 'Only an unsubmitted refund may be cancelled'; end if;
 perform public.money_adjustment_finish(a.id,null,'failed',extract(epoch from now())::bigint);
 insert into public.money_audit(actor_id,subject_id,action,details) values(p_actor,a.id,'refund_cancelled',jsonb_build_object('reason',p_reason));
end $$;

create function public.money_alert_resolve(p_key text,p_actor uuid,p_evidence text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where id=p_actor and role='admin') or length(trim(coalesce(p_evidence,'')))<5 then raise exception 'Administrator and evidence required'; end if;
 update public.money_alerts set resolved=true,updated_at=now() where key=p_key;
 if not found then raise exception 'Alert missing'; end if;
 insert into public.money_audit(actor_id,action,details) values(p_actor,'alert_resolved',jsonb_build_object('key',p_key,'evidence',p_evidence));
end $$;

create function public.money_invalidate_destination() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.verified and (old.account_name is distinct from new.account_name or old.account_number is distinct from new.account_number or old.method is distinct from new.method or old.bic is distinct from new.bic) then
  update public.money_verifications set status='expired',updated_at=now() where destination_id=old.id and status in ('submitted','pending','approved');
  new.verified=false;
 end if;
 return new;
end $$;
create trigger money_destination_reverification before update on public.money_destinations for each row execute function public.money_invalidate_destination();

-- A single worker owns each lease; expiry permits recovery after a crashed invocation.
create function public.money_job_claim(p_name text,p_token uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 insert into public.money_job_leases(name,token,expires_at) values(p_name,p_token,now()+interval '10 minutes')
 on conflict(name) do update set token=excluded.token,expires_at=excluded.expires_at where public.money_job_leases.expires_at<now();
 return found;
end $$;

-- Migrated balances were previously credited without settlement evidence. Restrict
-- those accounts until finance reviews their source reports; do not rewrite history.
insert into public.money_alerts(key,transaction_id,severity,message)
 select 'legacy:'||id,id,'critical','Pre-hold deposit: review legacy funds and settlement evidence before re-enabling this customer.' from public.money_transactions where kind='deposit' and status='completed';
update public.money_customers set blocked=true where user_id in(select user_id from public.money_wallets where available>0 or reserved>0);

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('money_customer_ready','money_guard_transaction','money_verification_decide','money_release_hold','money_adjustment_open','money_adjustment_finish','money_claim_refund','money_cancel_refund','money_job_claim','money_alert_resolve','money_invalidate_destination') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;

-- Requires migrations 03 and 04. No simulated balances are converted.

alter table public.money_transactions drop constraint if exists money_transactions_method_check;
alter table public.money_transactions add constraint money_transactions_method_check check(method in ('gcash','maya','qrph') and (method<>'qrph' or kind='deposit'));
create or replace function public.money_request(p_user uuid,p_kind text,p_amount bigint,p_method text,p_key uuid,p_destination uuid default null)
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
    or p_method is null or (p_kind='deposit' and p_method<>'qrph') or (p_kind='withdrawal' and p_method not in ('gcash','maya')) or p_key is null then raise exception 'Invalid money request'; end if;
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
revoke all on function public.money_request(uuid,text,bigint,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.money_request(uuid,text,bigint,text,uuid,uuid) to service_role;
notify pgrst,'reload schema';

-- Withdrawal-only identity review. No balance conversion or automatic settlement release.

create or replace function public.money_deposit_ready(p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users where id=p_user)
 and not exists(select 1 from public.money_customers where user_id=p_user and blocked)
 and not exists(select 1 from public.money_adjustments a join public.money_transactions t on t.id=a.transaction_id where t.user_id=p_user and a.kind='dispute' and a.status='open')
 and not exists(select 1 from public.money_wallets where user_id=p_user and debt>0)
 and not exists(select 1 from public.money_alerts a left join public.money_transactions t on t.id=a.transaction_id where not a.resolved and a.severity='critical' and (a.transaction_id is null or t.user_id=p_user))
$$;
revoke all on function public.money_deposit_ready(uuid) from public,anon,authenticated;
grant execute on function public.money_deposit_ready(uuid) to service_role;
create or replace function public.money_guard_transaction() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.kind='deposit' and tg_op='INSERT' and not public.money_deposit_ready(new.user_id) then raise exception 'Account restricted'; end if;
 if new.kind='withdrawal' and (tg_op='INSERT' or (new.status='processing' and old.status<>'processing'))
 and not public.money_customer_ready(new.user_id,new.destination_id) then raise exception 'Current identity/ownership approval required or account has a financial restriction'; end if;
 return new;
end $$;
create or replace function public.money_request(p_user uuid,p_kind text,p_amount bigint,p_method text,p_key uuid,p_destination uuid default null)
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
 if c.blocked then raise exception 'Account restricted'; end if;
 if p_kind='withdrawal' and (c.user_id is null or not c.verified) then raise exception 'Verified, unrestricted customer required'; end if;
 if p_kind='deposit' then
  insert into public.money_customers(user_id) values(p_user) on conflict do nothing;
 end if;
 if p_kind not in ('deposit','withdrawal') or p_amount is null or p_amount<10000 or p_amount>5000000
    or p_method is null or (p_kind='deposit' and p_method<>'qrph') or (p_kind='withdrawal' and p_method not in ('gcash','maya')) or p_key is null then raise exception 'Invalid money request'; end if;
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
revoke all on function public.money_request(uuid,text,bigint,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.money_request(uuid,text,bigint,text,uuid,uuid) to service_role;
notify pgrst,'reload schema';

-- Apply after 16. Existing requests retain admin approval. This migration sends no transfers.

create table if not exists public.money_settings (
 id boolean primary key default true check(id),
 withdrawal_mode text not null default 'admin_approval' check(withdrawal_mode in ('admin_approval','automatic')),
 updated_by uuid references auth.users(id),updated_at timestamptz not null default now()
);
insert into public.money_settings(id) values(true) on conflict do nothing;
alter table public.money_settings enable row level security;
revoke all on public.money_settings from public,anon,authenticated;
grant select,update on public.money_settings to service_role;
alter table public.money_transactions add column if not exists withdrawal_mode text not null default 'admin_approval' check(withdrawal_mode in ('admin_approval','automatic'));
create or replace function public.money_snapshot_withdrawal_mode() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.kind='withdrawal' then
  select withdrawal_mode into new.withdrawal_mode from public.money_settings where id=true for share;
 end if;
 return new;
end $$;
drop trigger if exists money_withdrawal_mode on public.money_transactions;
create trigger money_withdrawal_mode before insert on public.money_transactions for each row execute function public.money_snapshot_withdrawal_mode();
create or replace function public.money_set_withdrawal_mode(p_actor uuid,p_mode text,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare previous text;
begin
 if not exists(select 1 from public.profiles where id=p_actor and role='admin') then raise exception 'Administrator required'; end if;
 if p_mode is null or p_mode not in ('automatic','admin_approval') or length(trim(coalesce(p_reason,'')))<5 or length(p_reason)>500 then raise exception 'Mode and reason required'; end if;
 select withdrawal_mode into previous from public.money_settings where id=true for update;
 update public.money_settings set withdrawal_mode=p_mode,updated_by=p_actor,updated_at=now() where id=true;
 insert into public.money_audit(actor_id,action,details) values(p_actor,'withdrawal_mode_changed',jsonb_build_object('previous',previous,'mode',p_mode,'reason',p_reason));
end $$;
create or replace function public.money_claim_automatic_payout(p_id uuid) returns public.money_transactions language plpgsql security definer set search_path='' as $$
declare t public.money_transactions; customer uuid;
begin
 select user_id into strict customer from public.money_transactions where id=p_id;
 perform pg_advisory_xact_lock(hashtextextended(customer::text,0));
 select * into strict t from public.money_transactions where id=p_id for update;
 if t.kind<>'withdrawal' or t.withdrawal_mode<>'automatic' or t.status<>'reserved' or t.provider_reference is not null then raise exception 'Automatic payout already claimed or ineligible'; end if;
 if not exists(select 1 from public.money_customers where user_id=t.user_id and verified and not blocked)
 or not exists(select 1 from public.money_destinations where id=t.destination_id and verified)
 or not public.money_customer_ready(t.user_id,t.destination_id) then raise exception 'Customer or destination restricted'; end if;
 update public.money_transactions set status='processing',updated_at=now() where id=t.id returning * into t;
 insert into public.money_audit(subject_id,action,details) values(t.id,'claim_automatic_payout',jsonb_build_object('mode','automatic'));
 return t;
end $$;
revoke all on function public.money_snapshot_withdrawal_mode(),public.money_set_withdrawal_mode(uuid,text,text),public.money_claim_automatic_payout(uuid) from public,anon,authenticated;
grant execute on function public.money_set_withdrawal_mode(uuid,text,text),public.money_claim_automatic_payout(uuid) to service_role;
notify pgrst,'reload schema';

-- Requires 03,04,16,17. New live contracts only. Existing demo funds/contracts are never imported.

alter table public.money_transactions drop constraint if exists money_transactions_kind_check;
alter table public.money_transactions add constraint money_transactions_kind_check check(kind in ('deposit','withdrawal','investment_purchase','investment_return','referral_commission'));
alter table public.money_transactions drop constraint if exists money_transactions_amount_check;
alter table public.money_transactions add constraint money_transactions_amount_check check((kind in ('deposit','withdrawal') and amount between 10000 and 5000000) or (kind not in ('deposit','withdrawal') and amount between 1 and 100000000000));
alter table public.money_transactions drop constraint if exists money_transactions_method_check;
alter table public.money_transactions add constraint money_transactions_method_check check((kind='deposit' and method in ('gcash','maya','qrph')) or (kind='withdrawal' and method in ('gcash','maya')) or (kind not in ('deposit','withdrawal') and method='internal'));
create table if not exists public.money_business_budget(
 id boolean primary key default true check(id),available bigint not null default 0 check(available>=0),reserved bigint not null default 0 check(reserved>=0),sales bigint not null default 0 check(sales>=0),funded bigint not null default 0 check(funded>=0)
);
insert into public.money_business_budget(id) values(true) on conflict do nothing;
create table if not exists public.money_business_funding(
 id uuid primary key default gen_random_uuid(),actor_id uuid not null references auth.users(id),amount bigint not null check(amount>0),idempotency_key uuid not null unique,reference text not null unique,wallet_id text not null,provider_available bigint not null,created_at timestamptz not null default now()
);
create table if not exists public.money_investments(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),product_id uuid not null references public.investment_products(id),name text not null,price bigint not null check(price>0),daily_amount bigint not null check(daily_amount>0),duration_days integer not null default 365 check(duration_days between 1 and 365),claimed_days integer not null default 0 check(claimed_days>=0 and claimed_days<=duration_days),acquisition text not null check(acquisition in ('purchase','free_plan')),granted_by uuid references auth.users(id),note text not null default '',idempotency_key uuid not null,created_at timestamptz not null default now(),unique(user_id,idempotency_key)
);
create unique index if not exists money_one_free_plan on public.money_investments(user_id) where acquisition='free_plan';
create table if not exists public.money_investment_claims(
 investment_id uuid not null references public.money_investments(id),day_number integer not null,transaction_id uuid not null references public.money_transactions(id),amount bigint not null check(amount>0),created_at timestamptz not null default now(),primary key(investment_id,day_number)
);
create table if not exists public.money_referral_commissions(
 id uuid primary key default gen_random_uuid(),deposit_id uuid not null references public.money_transactions(id),beneficiary_id uuid not null references auth.users(id),depositor_id uuid not null references auth.users(id),level integer not null check(level between 1 and 3),amount bigint not null check(amount>0),status text not null default 'pending' check(status in ('pending','paid','cancelled')),transaction_id uuid unique references public.money_transactions(id),created_at timestamptz not null default now(),unique(deposit_id,level),unique(deposit_id,beneficiary_id),check(beneficiary_id<>depositor_id)
);
create table if not exists public.money_business_ledger(
 id bigint generated always as identity primary key,action text not null,subject_id uuid,available_delta bigint not null default 0,reserved_delta bigint not null default 0,sales_delta bigint not null default 0,created_at timestamptz not null default now()
);
do $$ declare t text; begin
 foreach t in array array['money_business_budget','money_business_funding','money_investments','money_investment_claims','money_referral_commissions','money_business_ledger'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to service_role',t);
 end loop;
end $$;
-- Verified server snapshot only. All existing member funds, future rewards and sales are excluded from allocatable cash.
create or replace function public.money_business_fund(p_actor uuid,p_amount bigint,p_key uuid,p_reference text,p_wallet text,p_provider_available bigint) returns uuid language plpgsql security definer set search_path='' as $$
declare b public.money_business_budget; f public.money_business_funding; liabilities numeric;
begin
 if not exists(select 1 from public.profiles where id=p_actor and role='admin') then raise exception 'Administrator required'; end if;
 if p_amount is null or p_amount<10000 or p_amount>100000000 or p_key is null or length(trim(coalesce(p_reference,''))) not between 5 and 120 or p_wallet is null or p_provider_available is null or p_provider_available<0 then raise exception 'Invalid business funding'; end if;
 select * into b from public.money_business_budget where id=true for update;
 select * into f from public.money_business_funding where idempotency_key=p_key;
 if found then
 if f.amount<>p_amount or f.actor_id<>p_actor or f.reference<>p_reference then raise exception 'Funding request conflict'; end if;
 return f.id;
 end if;
 if exists(select 1 from public.money_business_funding where reference=p_reference) then raise exception 'Funding reference already allocated'; end if;
 if exists(select 1 from public.money_wallets where debt>0) or exists(select 1 from public.money_alerts where not resolved and severity='critical') then raise exception 'Resolve payment shortfalls before allocating business funds'; end if;
 select coalesce(sum(available::numeric+reserved+held),0) into liabilities from public.money_wallets;
 if liabilities+b.available+b.reserved+b.sales+p_amount>p_provider_available then raise exception 'Insufficient unallocated verified PayMongo funds'; end if;
 insert into public.money_business_funding(actor_id,amount,idempotency_key,reference,wallet_id,provider_available) values(p_actor,p_amount,p_key,p_reference,p_wallet,p_provider_available) returning * into f;
 update public.money_business_budget set available=available+p_amount,funded=funded+p_amount where id=true;
 insert into public.money_business_ledger(action,subject_id,available_delta) values('business_funding',f.id,p_amount);
 insert into public.money_audit(actor_id,subject_id,action,details) values(p_actor,f.id,'business_funding',jsonb_build_object('amount',p_amount,'reference',p_reference,'wallet',p_wallet,'verified_available',p_provider_available));
 return f.id;
end $$;
create or replace function public.money_investment_open(p_user uuid,p_product uuid,p_key uuid,p_actor uuid default null,p_note text default '') returns public.money_investments language plpgsql security definer set search_path='' as $$
declare inv public.money_investments; b public.money_business_budget; product record; cost bigint; price bigint; daily bigint; tx uuid; v_acquisition text:=case when p_actor is null then 'purchase' else 'free_plan' end;
begin
 if p_key is null or p_user is null or p_product is null or length(coalesce(p_note,''))>300 then raise exception 'Invalid plan request'; end if;
 select * into b from public.money_business_budget where id=true for update;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 select * into inv from public.money_investments where user_id=p_user and idempotency_key=p_key;
 if found then
 if inv.product_id<>p_product or inv.acquisition<>v_acquisition or inv.granted_by is distinct from p_actor then raise exception 'Plan request conflict'; end if;
 return inv;
 end if;
 if not public.money_deposit_ready(p_user) then raise exception 'Account restricted'; end if;
 if p_actor is not null then
 if not exists(select 1 from public.profiles where id=p_actor and role='admin') then raise exception 'Administrator required'; end if;
 if not exists(select 1 from public.profiles where id=p_user and role='user') then raise exception 'Member account not found'; end if;
 if exists(select 1 from public.money_investments where user_id=p_user and acquisition='free_plan') then raise exception 'Member already received a free welcome plan'; end if;
 end if;
 select * into product from public.investment_products where id=p_product;
 if not found or product.price<=0 or product.daily_income<=0 or product.price<>round(product.price,2) or product.daily_income<>round(product.daily_income,2) then raise exception 'Product unavailable'; end if;
 price:=(product.price*100)::bigint;daily:=(product.daily_income*100)::bigint;cost:=daily*365;
 if price>100000000000 or cost>100000000000 or b.available<cost then raise exception 'Insufficient funded business rewards budget for this plan'; end if;
 if p_actor is null then
 update public.money_wallets set available=available-price where user_id=p_user and available>=price;
 if not found then raise exception 'Insufficient available balance'; end if;
 insert into public.money_transactions(user_id,kind,amount,method,status,idempotency_key) values(p_user,'investment_purchase',price,'internal','completed',p_key) returning id into tx;
 insert into public.money_ledger(user_id,transaction_id,action,available_delta,reserved_delta) values(p_user,tx,'plan_purchase',-price,0);
 end if;
 insert into public.money_investments(user_id,product_id,name,price,daily_amount,acquisition,granted_by,note,idempotency_key) values(p_user,p_product,product.name,price,daily,v_acquisition,p_actor,coalesce(p_note,''),p_key) returning * into inv;
 update public.money_business_budget set available=available-cost,reserved=reserved+cost,sales=sales+case when p_actor is null then price else 0 end where id=true;
 insert into public.money_business_ledger(action,subject_id,available_delta,reserved_delta,sales_delta) values(v_acquisition,inv.id,-cost,cost,case when p_actor is null then price else 0 end);
 insert into public.money_audit(actor_id,subject_id,action,details) values(coalesce(p_actor,p_user),inv.id,'live_plan_'||v_acquisition,jsonb_build_object('user',p_user,'product',p_product,'reserved_rewards',cost,'days',365));
 return inv;
end $$;
create or replace function public.money_investment_claim(p_user uuid,p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare inv public.money_investments; elapsed integer; days integer; amount bigint; tx uuid;
begin
 perform 1 from public.money_business_budget where id=true for update;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 select * into strict inv from public.money_investments where id=p_id and user_id=p_user for update;
 if not public.money_deposit_ready(p_user) then raise exception 'Account restricted'; end if;
 elapsed:=least(inv.duration_days,greatest(0,floor(extract(epoch from (now()-inv.created_at))/86400)::integer));days:=elapsed-inv.claimed_days;
 if days<=0 then return jsonb_build_object('claimed_days',0,'credited',0); end if;
 amount:=days*inv.daily_amount;
 update public.money_business_budget set reserved=reserved-amount where id=true and reserved>=amount;
 if not found then raise exception 'Rewards reserve mismatch'; end if;
 insert into public.money_transactions(user_id,kind,amount,method,status,idempotency_key) values(p_user,'investment_return',amount,'internal','completed',gen_random_uuid()) returning id into tx;
 insert into public.money_wallets(user_id,available) values(p_user,amount) on conflict(user_id) do update set available=public.money_wallets.available+excluded.available;
 insert into public.money_ledger(user_id,transaction_id,action,available_delta,reserved_delta) values(p_user,tx,'plan_return',amount,0);
 insert into public.money_investment_claims(investment_id,day_number,transaction_id,amount) select inv.id,d,tx,inv.daily_amount from generate_series(inv.claimed_days+1,elapsed) d;
 update public.money_investments set claimed_days=elapsed where id=inv.id;
 insert into public.money_business_ledger(action,subject_id,reserved_delta) values('plan_claim',inv.id,-amount);
 return jsonb_build_object('claimed_days',days,'credited',amount);
end $$;
-- A settled member deposit creates business-funded commissions. Payment confirmation alone is insufficient.
create or replace function public.money_referrals_process(p_deposit uuid) returns void language plpgsql security definer set search_path='' as $$
declare t public.money_transactions; current_user_id uuid; parent uuid; path uuid[]; lvl integer; amount bigint; c public.money_referral_commissions; tx uuid;
begin
 perform 1 from public.money_business_budget where id=true for update;
 select * into strict t from public.money_transactions where id=p_deposit and kind='deposit';
 if t.status<>'completed' or not exists(select 1 from public.money_holds where transaction_id=t.id and released) then return; end if;
 if not public.money_deposit_ready(t.user_id) then return; end if;
 if exists(select 1 from public.money_adjustments where transaction_id=t.id and status not in ('failed','won')) then
 update public.money_referral_commissions set status='cancelled' where deposit_id=t.id and status='pending';return;
 end if;
 current_user_id:=t.user_id;path:=array[t.user_id];
 for lvl in 1..3 loop
 select invited_by into parent from public.team_members where id=current_user_id;
 exit when parent is null or parent=any(path);path:=array_append(path,parent);
 amount:=floor(t.amount::numeric*(case lvl when 1 then 3000 when 2 then 200 else 100 end)/10000)::bigint;
 if amount>0 then insert into public.money_referral_commissions(deposit_id,beneficiary_id,depositor_id,level,amount) values(t.id,parent,t.user_id,lvl,amount) on conflict do nothing;end if;
 current_user_id:=parent;
 end loop;
 for c in select * from public.money_referral_commissions where deposit_id=t.id and status='pending' order by level for update loop
 if not public.money_deposit_ready(c.beneficiary_id) then continue; end if;
 update public.money_business_budget set available=available-c.amount where id=true and available>=c.amount;
 if not found then continue; end if;
 insert into public.money_transactions(user_id,kind,amount,method,status,idempotency_key) values(c.beneficiary_id,'referral_commission',c.amount,'internal','completed',c.id) returning id into tx;
 insert into public.money_wallets(user_id,available) values(c.beneficiary_id,c.amount) on conflict(user_id) do update set available=public.money_wallets.available+excluded.available;
 insert into public.money_ledger(user_id,transaction_id,action,available_delta,reserved_delta) values(c.beneficiary_id,tx,'referral_commission',c.amount,0);
 update public.money_referral_commissions set status='paid',transaction_id=tx where id=c.id;
 insert into public.money_business_ledger(action,subject_id,available_delta) values('referral_commission',c.id,-c.amount);
 end loop;
 insert into public.money_audit(subject_id,action) select t.id,'referral_batch_processed' where not exists(select 1 from public.money_audit where subject_id=t.id and action='referral_batch_processed');
end $$;
create or replace function public.money_referrals_backfill() returns integer language plpgsql security definer set search_path='' as $$
declare r record; checked integer:=0;
begin
 for r in select t.id from public.money_transactions t join public.money_holds h on h.transaction_id=t.id
 where t.kind='deposit' and t.status='completed' and h.released and
 (not exists(select 1 from public.money_audit a where a.subject_id=t.id and a.action='referral_batch_processed') or exists(select 1 from public.money_referral_commissions c where c.deposit_id=t.id and c.status='pending'))
 order by t.created_at,t.id limit 100 loop
 perform public.money_referrals_process(r.id);checked:=checked+1;
 end loop;
 return checked;
end $$;
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('money_business_fund','money_investment_open','money_investment_claim','money_referrals_process','money_referrals_backfill') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;

create or replace function public.money_live_team(p_user uuid) returns jsonb language sql stable security definer set search_path='' as $$
 with recursive tree as (
 select t.id,t.created_at,1 as level,array[p_user,t.id] as path from public.team_members t where t.invited_by=p_user and t.id<>p_user
 union all select t.id,t.created_at,p.level+1,p.path||t.id from public.team_members t join tree p on t.invited_by=p.id where p.level<3 and not t.id=any(p.path)
 ) select jsonb_build_object('total_commission',coalesce((select sum(amount) from public.money_referral_commissions where beneficiary_id=p_user and status='paid'),0),
 'pending_commission',coalesce((select sum(amount) from public.money_referral_commissions where beneficiary_id=p_user and status='pending'),0),
 'levels',(select jsonb_agg(jsonb_build_object('level',l,'rate',case l when 1 then 30 when 2 then 2 else 1 end,'count',(select count(*) from tree where level=l),
 'commission',coalesce((select sum(amount) from public.money_referral_commissions where beneficiary_id=p_user and level=l and status='paid'),0),
 'members',coalesce((select jsonb_agg(to_jsonb(m)) from (
 select page.id,page.created_at,right(regexp_replace(coalesce(u.phone,''),'[^0-9]','','g'),4) phone_last4,
 coalesce((select sum(t.amount) from public.money_transactions t where t.user_id=page.id and t.kind='deposit' and t.status='completed'),0) deposits,
 coalesce((select sum(c.amount) from public.money_referral_commissions c where c.beneficiary_id=p_user and c.depositor_id=page.id and c.status='paid'),0) commission
 from (select * from tree where level=l order by created_at desc,id limit 100) page left join auth.users u on u.id=page.id
 ) m),'[]'::jsonb)) order by l) from generate_series(1,3) l))
$$;
revoke all on function public.money_live_team(uuid) from public,anon,authenticated;
grant execute on function public.money_live_team(uuid) to service_role;
notify pgrst,'reload schema';

-- Requires migrations 03,04,15,16,17,18. No sandbox money is imported.

set local lock_timeout='10s';
do $$ begin
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='money_wallets' and column_name='deposit_available')
 and (exists(select 1 from public.money_wallets where available<>0 or reserved<>0 or held<>0 or debt<>0) or exists(select 1 from public.money_ledger)) then
 raise exception 'Existing live ledger requires a reviewed source-of-funds reconciliation before migration 19';
 end if;
end $$;
alter table public.money_wallets add column if not exists deposit_available bigint not null default 0 check(deposit_available>=0);
alter table public.money_ledger add column if not exists deposit_delta bigint not null default 0;
alter table public.money_adjustments add column if not exists deposit_part bigint not null default 0 check(deposit_part>=0);
do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid='public.money_adjustments'::regclass and contype='c' and pg_get_constraintdef(oid) like '%held_part%' and pg_get_constraintdef(oid) like '%shortfall%' loop
 execute format('alter table public.money_adjustments drop constraint %I',c.conname);
 end loop;
end $$;
alter table public.money_adjustments add constraint money_adjustment_parts check(held_part+available_part+deposit_part+shortfall=amount);
alter table public.money_transactions drop constraint if exists money_transactions_kind_check;
alter table public.money_transactions add constraint money_transactions_kind_check check(kind in ('deposit','withdrawal','investment_purchase','investment_return','referral_commission','registration_bonus'));
create table if not exists public.money_registration_bonuses(
 user_id uuid primary key references auth.users(id), transaction_id uuid not null unique references public.money_transactions(id),
 amount bigint not null default 3000 check(amount=3000),created_at timestamptz not null default now()
);
alter table public.money_registration_bonuses enable row level security;
revoke all on public.money_registration_bonuses from public,anon,authenticated,service_role;
grant select on public.money_registration_bonuses to service_role;
create or replace function public.money_release_hold(p_id uuid,p_actor uuid,p_evidence text)
returns void language plpgsql security definer set search_path='' as $$
declare t public.money_transactions; h public.money_holds; w public.money_wallets; repayment bigint; remaining_payment bigint; debt_row record; paid bigint;
begin
 select * into strict t from public.money_transactions where id=p_id;
 perform pg_advisory_xact_lock(hashtextextended(t.user_id::text,0));
 if not exists(select 1 from public.profiles where id=p_actor and role='admin') or p_actor=t.user_id then raise exception 'Independent administrator required'; end if;
 if length(trim(coalesce(p_evidence,'')))<5 then raise exception 'Settlement report evidence required'; end if;
 select * into strict h from public.money_holds where transaction_id=p_id for update;
 if h.released then return; end if;
 if exists(select 1 from public.money_adjustments where transaction_id=p_id and status in ('requested','submitting','pending','open')) then raise exception 'Active refund or dispute prevents release'; end if;
 if exists(select 1 from public.money_customers where user_id=t.user_id and blocked) then raise exception 'Restricted customer'; end if;
 if exists(select 1 from public.money_alerts a left join public.money_transactions mt on mt.id=a.transaction_id where not a.resolved and a.severity='critical' and (a.transaction_id is null or mt.user_id=t.user_id)) then raise exception 'Unresolved risk alert prevents settlement release'; end if;
 select * into strict w from public.money_wallets where user_id=t.user_id for update;
 repayment=least(w.debt,h.remaining);
 remaining_payment=repayment;
 for debt_row in select ma.id,ma.debt_remaining from public.money_adjustments ma join public.money_transactions mt on mt.id=ma.transaction_id where mt.user_id=t.user_id and ma.debt_remaining>0 order by ma.created_at,ma.id for update of ma loop
  paid=least(remaining_payment,debt_row.debt_remaining);
  update public.money_adjustments set debt_remaining=debt_remaining-paid where id=debt_row.id;
  remaining_payment=remaining_payment-paid;
  exit when remaining_payment=0;
 end loop;
 if remaining_payment<>0 then raise exception 'Debt ledger mismatch'; end if;
 update public.money_wallets set held=held-h.remaining,deposit_available=deposit_available+h.remaining-repayment,debt=debt-repayment where user_id=t.user_id;
 insert into public.money_ledger(user_id,transaction_id,action,available_delta,reserved_delta,held_delta,debt_delta,deposit_delta) values(t.user_id,t.id,'settlement_release',0,0,-h.remaining,-repayment,h.remaining-repayment);
 update public.money_holds set remaining=0,released=true,released_at=now(),settlement_reference=p_evidence where transaction_id=t.id;
 insert into public.money_audit(actor_id,subject_id,action,details) values(p_actor,t.id,'settlement_release',jsonb_build_object('evidence',p_evidence));
end $$;

create or replace function public.money_adjustment_open(p_id uuid,p_kind text,p_amount bigint,p_key uuid,p_reference text,p_actor uuid,p_reason text)
returns public.money_adjustments language plpgsql security definer set search_path='' as $$
declare t public.money_transactions; a public.money_adjustments; h public.money_holds; w public.money_wallets; hp bigint; ap bigint; dp bigint; gap bigint;
begin
 select * into strict t from public.money_transactions where id=p_id;
 perform pg_advisory_xact_lock(hashtextextended(t.user_id::text,0));
 select * into strict t from public.money_transactions where id=p_id for update;
 if p_key is not null then select * into a from public.money_adjustments where idempotency_key=p_key;
  if found then
   if a.transaction_id<>p_id or a.kind<>p_kind or a.amount<>p_amount then raise exception 'Idempotency key conflict'; end if;
   return a;
  end if;
 end if;
 if p_reference is not null then select * into a from public.money_adjustments where provider_reference=p_reference;
  if found then
   if a.transaction_id<>p_id or a.kind<>p_kind or a.amount<>p_amount then raise exception 'Adjustment mismatch'; end if;
   return a;
  end if;
 end if;
 if p_kind is null or p_kind not in ('refund','dispute') or p_amount is null or p_amount<1 or p_amount>t.amount or t.kind<>'deposit' or t.status<>'completed' or t.payment_id is null then raise exception 'Invalid adjustment'; end if;
 if p_reference is null and (p_actor is null or not exists(select 1 from public.profiles where id=p_actor and role='admin') or p_actor=t.user_id) then raise exception 'Independent administrator required'; end if;
 if length(trim(coalesce(p_reason,'')))<5 then raise exception 'Adjustment reason required'; end if;
 if p_kind='refund' and (select coalesce(sum(amount),0) from public.money_adjustments where transaction_id=t.id and kind='refund' and status<>'failed')+p_amount>t.amount then raise exception 'Refund exceeds remaining payment'; end if;
 if p_reference is null and exists(select 1 from public.money_adjustments where transaction_id=t.id and kind='dispute' and status in ('open','lost')) then raise exception 'Disputed payment cannot be refunded'; end if;
 select * into strict w from public.money_wallets where user_id=t.user_id for update;
 select * into h from public.money_holds where transaction_id=t.id for update;
 hp=least(coalesce(h.remaining,0),p_amount); dp=least(w.deposit_available,p_amount-hp); ap=least(w.available,p_amount-hp-dp);gap=p_amount-hp-dp-ap;
 if p_reference is null and gap>0 then raise exception 'Insufficient refundable balance'; end if;
 insert into public.money_adjustments(transaction_id,kind,amount,status,provider_reference,idempotency_key,held_part,available_part,shortfall,debt_remaining,created_by,reason,deposit_part)
 values(t.id,p_kind,p_amount,case when p_kind='dispute' then 'open' when p_reference is null then 'requested' else 'pending' end,p_reference,p_key,hp,ap,gap,gap,p_actor,p_reason,dp) returning * into a;
 update public.money_wallets set held=held-hp,available=available-ap,deposit_available=deposit_available-dp,reserved=reserved+hp+ap+dp,debt=debt+gap where user_id=t.user_id;
 update public.money_holds set remaining=remaining-hp where transaction_id=t.id;
 insert into public.money_ledger(user_id,transaction_id,action,available_delta,reserved_delta,held_delta,debt_delta,deposit_delta) values(t.user_id,t.id,'adjustment_reserve:'||a.id,-ap,hp+ap+dp,-hp,gap,-dp);
 insert into public.money_audit(actor_id,subject_id,action,details) values(p_actor,t.id,p_kind||'_opened',jsonb_build_object('adjustment',a.id,'amount',p_amount,'shortfall',gap));
 if gap>0 or p_kind='dispute' then
  insert into public.money_alerts(key,transaction_id,severity,message) values('adjustment:'||a.id,t.id,'critical','Refund/dispute requires review; withdrawals restricted while dispute or debt remains.') on conflict(key) do nothing;
 end if;
 return a;
end $$;

create or replace function public.money_adjustment_finish(p_id uuid,p_reference text,p_status text,p_provider_at bigint)
returns void language plpgsql security definer set search_path='' as $$
declare a public.money_adjustments; t public.money_transactions; returning_funds boolean; hp bigint;
begin
 select t0.* into strict t from public.money_adjustments a0 join public.money_transactions t0 on t0.id=a0.transaction_id where a0.id=p_id;
 perform pg_advisory_xact_lock(hashtextextended(t.user_id::text,0));
 select * into strict a from public.money_adjustments where id=p_id for update;
 if a.provider_reference is distinct from p_reference or p_status is null or
 (a.kind='refund' and p_status not in ('pending','processing','succeeded','failed')) or (a.kind='dispute' and p_status not in ('open','won','lost')) then raise exception 'Adjustment mismatch'; end if;
 if a.status in ('succeeded','failed','won','lost') then
  if a.status=p_status then return; end if;
  if p_provider_at<=a.last_provider_at then return; end if;
  raise exception 'Conflicting terminal adjustment';
 end if;
 if p_provider_at<a.last_provider_at then return; end if;
 if p_status in ('pending','processing','open') then
  update public.money_adjustments set last_provider_at=p_provider_at,status=case when p_status='processing' then 'pending' else p_status end,updated_at=now() where id=a.id; return;
 end if;
 returning_funds=p_status in ('failed','won');
 -- Returned hold funds remain held even if the original deposit was released meanwhile.
 hp=case when returning_funds then a.held_part else 0 end;
 update public.money_wallets set reserved=reserved-a.held_part-a.available_part-a.deposit_part,
 available=available+case when returning_funds then a.available_part else 0 end,
 deposit_available=deposit_available+case when returning_funds then a.deposit_part+a.shortfall-a.debt_remaining else 0 end,
 held=held+hp,debt=debt-case when returning_funds then a.debt_remaining else 0 end where user_id=t.user_id;
 if hp>0 then update public.money_holds set remaining=remaining+hp,released=false where transaction_id=t.id; end if;
 update public.money_adjustments set status=p_status,last_provider_at=p_provider_at,debt_remaining=case when returning_funds then 0 else debt_remaining end,updated_at=now() where id=a.id;
 insert into public.money_ledger(user_id,transaction_id,action,available_delta,reserved_delta,held_delta,debt_delta,deposit_delta)
 values(t.user_id,t.id,'adjustment_finish:'||a.id,case when returning_funds then a.available_part else 0 end,-a.held_part-a.available_part-a.deposit_part,hp,case when returning_funds then -a.debt_remaining else 0 end,case when returning_funds then a.deposit_part+a.shortfall-a.debt_remaining else 0 end);
 insert into public.money_audit(subject_id,action,details) values(t.id,'adjustment_'||p_status,jsonb_build_object('adjustment',a.id,'reference',p_reference));
 update public.money_alerts set resolved=true,updated_at=now() where key='adjustment:'||a.id and returning_funds;
end $$;

create or replace function public.money_business_fund(p_actor uuid,p_amount bigint,p_key uuid,p_reference text,p_wallet text,p_provider_available bigint) returns uuid language plpgsql security definer set search_path='' as $$
declare b public.money_business_budget; f public.money_business_funding; liabilities numeric;
begin
 if not exists(select 1 from public.profiles where id=p_actor and role='admin') then raise exception 'Administrator required'; end if;
 if p_amount is null or p_amount<10000 or p_amount>100000000 or p_key is null or length(trim(coalesce(p_reference,''))) not between 5 and 120 or p_wallet is null or p_provider_available is null or p_provider_available<0 then raise exception 'Invalid business funding'; end if;
 select * into b from public.money_business_budget where id=true for update;
 select * into f from public.money_business_funding where idempotency_key=p_key;
 if found then
 if f.amount<>p_amount or f.actor_id<>p_actor or f.reference<>p_reference then raise exception 'Funding request conflict'; end if;
 return f.id;
 end if;
 if exists(select 1 from public.money_business_funding where reference=p_reference) then raise exception 'Funding reference already allocated'; end if;
 if exists(select 1 from public.money_wallets where debt>0) or exists(select 1 from public.money_alerts where not resolved and severity='critical') then raise exception 'Resolve payment shortfalls before allocating business funds'; end if;
 select coalesce(sum(available::numeric+reserved+held+deposit_available),0) into liabilities from public.money_wallets;
 if liabilities+b.available+b.reserved+b.sales+p_amount>p_provider_available then raise exception 'Insufficient unallocated verified PayMongo funds'; end if;
 insert into public.money_business_funding(actor_id,amount,idempotency_key,reference,wallet_id,provider_available) values(p_actor,p_amount,p_key,p_reference,p_wallet,p_provider_available) returning * into f;
 update public.money_business_budget set available=available+p_amount,funded=funded+p_amount where id=true;
 insert into public.money_business_ledger(action,subject_id,available_delta) values('business_funding',f.id,p_amount);
 insert into public.money_audit(actor_id,subject_id,action,details) values(p_actor,f.id,'business_funding',jsonb_build_object('amount',p_amount,'reference',p_reference,'wallet',p_wallet,'verified_available',p_provider_available));
 return f.id;
end $$;

create or replace function public.money_investment_open(p_user uuid,p_product uuid,p_key uuid,p_actor uuid default null,p_note text default '') returns public.money_investments language plpgsql security definer set search_path='' as $$
declare inv public.money_investments; b public.money_business_budget; product record; cost bigint; price bigint; daily bigint; tx uuid; w public.money_wallets; from_deposit bigint; from_available bigint; v_acquisition text:=case when p_actor is null then 'purchase' else 'free_plan' end;
begin
 if p_key is null or p_user is null or p_product is null or length(coalesce(p_note,''))>300 then raise exception 'Invalid plan request'; end if;
 select * into b from public.money_business_budget where id=true for update;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 select * into inv from public.money_investments where user_id=p_user and idempotency_key=p_key;
 if found then
 if inv.product_id<>p_product or inv.acquisition<>v_acquisition or inv.granted_by is distinct from p_actor then raise exception 'Plan request conflict'; end if;
 return inv;
 end if;
 if not public.money_deposit_ready(p_user) then raise exception 'Account restricted'; end if;
 if p_actor is not null then
 if not exists(select 1 from public.profiles where id=p_actor and role='admin') then raise exception 'Administrator required'; end if;
 if not exists(select 1 from public.profiles where id=p_user and role='user') then raise exception 'Member account not found'; end if;
 if exists(select 1 from public.money_investments where user_id=p_user and acquisition='free_plan') then raise exception 'Member already received a free welcome plan'; end if;
 end if;
 select * into product from public.investment_products where id=p_product;
 if not found or product.price<=0 or product.daily_income<=0 or product.price<>round(product.price,2) or product.daily_income<>round(product.daily_income,2) then raise exception 'Product unavailable'; end if;
 price:=(product.price*100)::bigint;daily:=(product.daily_income*100)::bigint;cost:=daily*365;
 if price>100000000000 or cost>100000000000 or b.available<cost then raise exception 'Insufficient funded business rewards budget for this plan'; end if;
 if p_actor is null then
 select * into strict w from public.money_wallets where user_id=p_user for update;
 if w.available::numeric+w.deposit_available<price then raise exception 'Insufficient available balance'; end if;
 from_deposit=least(w.deposit_available,price);from_available=price-from_deposit;
 update public.money_wallets set deposit_available=deposit_available-from_deposit,available=available-from_available where user_id=p_user;
 insert into public.money_transactions(user_id,kind,amount,method,status,idempotency_key) values(p_user,'investment_purchase',price,'internal','completed',p_key) returning id into tx;
 insert into public.money_ledger(user_id,transaction_id,action,available_delta,reserved_delta,deposit_delta) values(p_user,tx,'plan_purchase',-from_available,0,-from_deposit);
 end if;
 insert into public.money_investments(user_id,product_id,name,price,daily_amount,acquisition,granted_by,note,idempotency_key) values(p_user,p_product,product.name,price,daily,v_acquisition,p_actor,coalesce(p_note,''),p_key) returning * into inv;
 update public.money_business_budget set available=available-cost,reserved=reserved+cost,sales=sales+case when p_actor is null then price else 0 end where id=true;
 insert into public.money_business_ledger(action,subject_id,available_delta,reserved_delta,sales_delta) values(v_acquisition,inv.id,-cost,cost,case when p_actor is null then price else 0 end);
 insert into public.money_audit(actor_id,subject_id,action,details) values(coalesce(p_actor,p_user),inv.id,'live_plan_'||v_acquisition,jsonb_build_object('user',p_user,'product',p_product,'reserved_rewards',cost,'days',365));
 return inv;
end $$;
create or replace function public.money_registration_bonus(p_user uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare existing uuid; tx uuid;
begin
 perform 1 from public.money_business_budget where id=true for update;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 select transaction_id into existing from public.money_registration_bonuses where user_id=p_user;
 if found then return existing; end if;
 if p_user is null or not public.money_deposit_ready(p_user) then raise exception 'Account restricted'; end if;
 update public.money_business_budget set available=available-3000 where id=true and available>=3000;
 if not found then raise exception 'Registration bonus is awaiting business funding'; end if;
 insert into public.money_transactions(user_id,kind,amount,method,status,idempotency_key) values(p_user,'registration_bonus',3000,'internal','completed',gen_random_uuid()) returning id into tx;
 insert into public.money_wallets(user_id,available) values(p_user,3000) on conflict(user_id) do update set available=public.money_wallets.available+3000;
 insert into public.money_ledger(user_id,transaction_id,action,available_delta,reserved_delta) values(p_user,tx,'registration_bonus',3000,0);
 insert into public.money_registration_bonuses(user_id,transaction_id) values(p_user,tx);
 insert into public.money_business_ledger(action,subject_id,available_delta) values('registration_bonus',tx,-3000);
 insert into public.money_audit(subject_id,action,details) values(p_user,'registration_bonus',jsonb_build_object('amount',3000,'transaction',tx));
 return tx;
end $$;
revoke all on function public.money_registration_bonus(uuid) from public,anon,authenticated;
grant execute on function public.money_registration_bonus(uuid) to service_role;
notify pgrst,'reload schema';


set local lock_timeout = '10s';

alter table public.money_transactions drop constraint money_transactions_kind_check;
alter table public.money_transactions add constraint money_transactions_kind_check check (kind in (
  'deposit','withdrawal','investment_purchase','investment_return','referral_commission',
  'registration_bonus','registration_bonus_reversal','daily_task_reward','check_in_reward','gift_code_reward','admin_balance_grant'
));

create table public.money_gift_codes (
  code_hash text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id),
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  max_claims integer not null check (max_claims between 1 and 100)
);
create table public.money_promo_claims (
  user_id uuid not null references auth.users(id),
  kind text not null check (kind in ('check_in_reward','gift_code_reward')),
  claim_key text not null,
  transaction_id uuid not null unique references public.money_transactions(id),
  amount bigint not null check (amount > 0),
  primary key (user_id,kind,claim_key)
);
alter table public.money_gift_codes enable row level security;
alter table public.money_promo_claims enable row level security;
revoke all on public.money_gift_codes, public.money_promo_claims from public, anon, authenticated, service_role;
grant insert on public.money_gift_codes to service_role;

create function public.money_check_in_status(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.money_promo_claims
    where user_id=p_user and kind='check_in_reward'
    and claim_key=((now() at time zone 'Asia/Manila')::date)::text);
$$;

create function public.money_claim_promo(p_user uuid,p_kind text,p_code_hash text default null,p_gift_amount bigint default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_key text;
  v_amount bigint;
  v_required bigint;
  v_tx uuid;
  v_code public.money_gift_codes;
  v_prior public.money_promo_claims;
begin
  if p_kind='check_in_reward' then
    v_key:=((now() at time zone 'Asia/Manila')::date)::text;
    v_amount:=500;
    v_required:=500;
  elsif p_kind='gift_code_reward' and p_code_hash ~ '^[0-9a-f]{64}$'
      and p_gift_amount between 100 and 1000 and p_gift_amount % 100 = 0 then
    v_key:=p_code_hash;
    v_amount:=p_gift_amount;
    v_required:=1000;
  else
    raise exception 'Invalid reward request';
  end if;

  perform 1 from public.money_business_budget where id=true for update;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
  if not public.money_deposit_ready(p_user) then raise exception 'Account restricted'; end if;
  select * into v_prior from public.money_promo_claims where user_id=p_user and kind=p_kind and claim_key=v_key;
  if found then return jsonb_build_object('alreadyClaimed',true,'amount',v_prior.amount); end if;

  if p_kind='gift_code_reward' then
    select * into v_code from public.money_gift_codes where code_hash=v_key for update;
    if not found or v_code.expires_at <= clock_timestamp() then raise exception 'Invalid or expired gift code'; end if;
    if (select count(*) from public.money_promo_claims where kind=p_kind and claim_key=v_key) >= v_code.max_claims then
      raise exception 'Gift code is fully claimed';
    end if;
  end if;

  update public.money_business_budget set available=available-v_amount where id=true and available>=v_required;
  if not found then raise exception 'Insufficient funded business rewards budget'; end if;
  insert into public.money_transactions(user_id,kind,amount,method,status,idempotency_key)
    values(p_user,p_kind,v_amount,'internal','completed',gen_random_uuid()) returning id into v_tx;
  insert into public.money_wallets(user_id,available) values(p_user,v_amount)
    on conflict(user_id) do update set available=public.money_wallets.available+excluded.available;
  insert into public.money_ledger(user_id,transaction_id,action,available_delta,reserved_delta)
    values(p_user,v_tx,p_kind,v_amount,0);
  insert into public.money_business_ledger(action,subject_id,available_delta) values(p_kind,v_tx,-v_amount);
  insert into public.money_promo_claims(user_id,kind,claim_key,transaction_id,amount) values(p_user,p_kind,v_key,v_tx,v_amount);
  return jsonb_build_object('alreadyClaimed',false,'amount',v_amount);
end $$;

revoke all on function public.money_check_in_status(uuid), public.money_claim_promo(uuid,text,text,bigint) from public,anon,authenticated;
grant execute on function public.money_check_in_status(uuid), public.money_claim_promo(uuid,text,text,bigint) to service_role;
notify pgrst,'reload schema';


create table public.manual_qrph_deposits (
  transaction_id uuid primary key references public.money_transactions(id),
  instapay_reference text not null check (instapay_reference ~ '^[A-Z0-9-]{5,80}$'),
  receipt text not null check (length(receipt) <= 2800000)
);
alter table public.manual_qrph_deposits enable row level security;
revoke all on public.manual_qrph_deposits from public, anon, authenticated;
grant select on public.manual_qrph_deposits to service_role;

create function public.money_submit_manual_qrph(p_user uuid, p_amount bigint, p_key uuid, p_reference text, p_receipt text)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  deposit public.money_transactions;
begin
  deposit := public.money_request(p_user, 'deposit', p_amount, 'qrph', p_key, null);
  select * into strict deposit from public.money_transactions where id=deposit.id for update;
  if deposit.provider_reference is null and deposit.status <> 'pending' then
    raise exception 'Deposit is already being processed';
  end if;
  if deposit.checkout_url is not null or (
    deposit.provider_reference is not null and deposit.provider_reference not like 'manual-qrph:%'
  ) then raise exception 'Deposit is already linked to another payment flow'; end if;
  insert into public.manual_qrph_deposits(transaction_id, instapay_reference, receipt)
  values (deposit.id, p_reference, p_receipt)
  on conflict (transaction_id) do nothing;
  if not exists (select 1 from public.manual_qrph_deposits where transaction_id=deposit.id
    and instapay_reference=p_reference and receipt=p_receipt) then
    raise exception 'Manual deposit request details changed';
  end if;
  update public.money_transactions set provider_reference='manual-qrph:' || deposit.id
  where id=deposit.id and status='pending' and provider_reference is null;
  return deposit.id;
end $$;

create function public.money_verify_manual_qrph(p_id uuid, p_actor uuid, p_payment text)
returns void language plpgsql security definer set search_path='' as $$
declare
  deposit public.money_transactions;
  member_id uuid;
  payment_reference text := 'manual-qrph:' || p_payment;
begin
  select user_id into strict member_id from public.money_transactions where id=p_id;
  perform pg_advisory_xact_lock(hashtextextended(member_id::text,0));
  select * into strict deposit from public.money_transactions where id=p_id for update;
  if p_actor=member_id or not exists (select 1 from public.profiles where id=p_actor and role='admin') then
    raise exception 'Independent administrator required';
  end if;
  if deposit.kind<>'deposit' or deposit.method<>'qrph' or deposit.checkout_url is not null
    or p_payment is null or p_payment !~ '^pay_[A-Za-z0-9]+$'
    or not exists (select 1 from public.manual_qrph_deposits where transaction_id=p_id) then
    raise exception 'Invalid manual deposit';
  end if;
  if deposit.status='completed' and deposit.payment_id=p_payment then return; end if;
  if deposit.status<>'pending' or deposit.provider_reference is distinct from 'manual-qrph:' || deposit.id
    or deposit.payment_id is not null then
    raise exception 'Deposit is already linked or reviewed';
  end if;
  update public.money_transactions
  set payment_id=p_payment, provider_reference=payment_reference, reviewed_by=p_actor
  where id=p_id;
  perform public.money_credit(p_id, payment_reference, payment_reference, deposit.amount);
  insert into public.money_audit(actor_id, subject_id, action)
  values (p_actor, p_id, 'manual_qrph_verified');
end $$;

revoke all on function public.money_submit_manual_qrph(uuid,bigint,uuid,text,text),
  public.money_verify_manual_qrph(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.money_submit_manual_qrph(uuid,bigint,uuid,text,text),
  public.money_verify_manual_qrph(uuid,uuid,text) to service_role;


set local lock_timeout = '10s';

alter table public.money_transactions
  add column withdrawal_fee bigint not null default 0,
  add constraint money_transactions_withdrawal_fee_check
    check (withdrawal_fee = 0 or (kind = 'withdrawal' and withdrawal_fee > 0 and withdrawal_fee < amount));

create function public.money_request_withdrawal(
  p_user uuid, p_amount bigint, p_method text, p_key uuid, p_destination uuid
)
returns public.money_transactions
language plpgsql security definer set search_path = ''
as $$
declare
  withdrawal public.money_transactions;
  already_exists boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));
  select exists (
    select 1 from public.money_transactions
    where user_id = p_user and kind = 'withdrawal' and idempotency_key = p_key
  ) into already_exists;
  withdrawal := public.money_request(p_user, 'withdrawal', p_amount, p_method, p_key, p_destination);

  if not already_exists then
    update public.money_transactions
    set withdrawal_fee = (amount + 10) / 20
    where id = withdrawal.id
    returning * into withdrawal;
  end if;
  return withdrawal;
end
$$;

revoke all on function public.money_request_withdrawal(uuid,bigint,text,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.money_request_withdrawal(uuid,bigint,text,uuid,uuid)
  to service_role;
notify pgrst, 'reload schema';


create function public.money_approve_gcash_deposit(p_id uuid, p_actor uuid, p_reference text)
returns void language plpgsql security definer set search_path='' as $$
declare
  deposit public.money_transactions;
  member_id uuid;
  payment_reference text := 'manual-qrph:gcash:' || p_reference;
begin
  select user_id into strict member_id from public.money_transactions where id=p_id;
  perform pg_advisory_xact_lock(hashtextextended(member_id::text,0));
  select * into strict deposit from public.money_transactions where id=p_id for update;
  if p_actor is null or p_actor=member_id
    or not exists (select 1 from public.profiles where id=p_actor and role='admin') then
    raise exception 'Independent administrator required';
  end if;
  if deposit.kind<>'deposit' or deposit.method<>'qrph' or deposit.payment_id is not null
    or deposit.checkout_url is not null or p_reference is null
    or not exists (select 1 from public.manual_qrph_deposits
      where transaction_id=p_id and instapay_reference='GCASH-' || p_reference) then
    raise exception 'Invalid GCash deposit';
  end if;
  if deposit.status='completed' and deposit.provider_reference=payment_reference then return; end if;
  if deposit.status<>'pending' or deposit.provider_reference is distinct from 'manual-qrph:' || p_id then
    raise exception 'Deposit is already linked or reviewed';
  end if;
  if exists (select 1 from public.money_transactions where provider_reference=payment_reference) then
    raise exception 'GCash reference already credited';
  end if;
  update public.money_transactions set provider_reference=payment_reference, reviewed_by=p_actor where id=p_id;
  perform public.money_credit(p_id,payment_reference,payment_reference,deposit.amount);
  perform public.money_release_hold(p_id,p_actor,payment_reference);
  insert into public.money_audit(actor_id,subject_id,action,details)
  values (p_actor,p_id,'manual_gcash_approved',jsonb_build_object('reference',p_reference));
end $$;

revoke all on function public.money_approve_gcash_deposit(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.money_approve_gcash_deposit(uuid,uuid,text) to service_role;


create function public.money_approve_palawan_deposit(p_id uuid, p_actor uuid, p_reference text)
returns void language plpgsql security definer set search_path='' as $$
declare
  deposit public.money_transactions;
  member_id uuid;
  payment_reference text := 'manual-qrph:palawan:' || p_reference;
begin
  select user_id into strict member_id from public.money_transactions where id=p_id;
  perform pg_advisory_xact_lock(hashtextextended(member_id::text,0));
  select * into strict deposit from public.money_transactions where id=p_id for update;
  if p_actor is null or p_actor=member_id
    or not exists (select 1 from public.profiles where id=p_actor and role='admin') then
    raise exception 'Independent administrator required';
  end if;
  if deposit.kind<>'deposit' or deposit.method<>'qrph' or deposit.payment_id is not null
    or deposit.checkout_url is not null or p_reference is null
    or not exists (select 1 from public.manual_qrph_deposits
      where transaction_id=p_id and instapay_reference='PALAWAN-' || p_reference) then
    raise exception 'Invalid PalawanPay deposit';
  end if;
  if deposit.status='completed' and deposit.provider_reference=payment_reference then return; end if;
  if deposit.status<>'pending' or deposit.provider_reference is distinct from 'manual-qrph:' || p_id then
    raise exception 'Deposit is already linked or reviewed';
  end if;
  if exists (select 1 from public.money_transactions where provider_reference=payment_reference) then
    raise exception 'PalawanPay reference already credited';
  end if;
  update public.money_transactions set provider_reference=payment_reference, reviewed_by=p_actor where id=p_id;
  perform public.money_credit(p_id,payment_reference,payment_reference,deposit.amount);
  perform public.money_release_hold(p_id,p_actor,payment_reference);
  insert into public.money_audit(actor_id,subject_id,action,details)
  values (p_actor,p_id,'manual_palawan_approved',jsonb_build_object('reference',p_reference));
end $$;

revoke all on function public.money_approve_palawan_deposit(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.money_approve_palawan_deposit(uuid,uuid,text) to service_role;
create function public.money_reject_palawan_deposit(p_id uuid,p_actor uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare t public.money_transactions;
begin
  select * into strict t from public.money_transactions where id=p_id for update;
  if p_actor is null or p_actor=t.user_id or not exists(select 1 from public.profiles where id=p_actor and role='admin') then
    raise exception 'Independent administrator required';
  end if;
  if t.kind<>'deposit' or not exists(select 1 from public.manual_qrph_deposits where transaction_id=p_id and instapay_reference like 'PALAWAN-%')
    or p_reason is null or length(trim(p_reason)) not between 5 and 500 then raise exception 'Invalid rejection'; end if;
  if t.status='rejected' then return; end if;
  if t.status<>'pending' or t.provider_reference is distinct from 'manual-qrph:'||p_id then raise exception 'Deposit already reviewed'; end if;
  update public.money_transactions set status='rejected',reviewed_by=p_actor where id=p_id;
  insert into public.money_audit(actor_id,subject_id,action,details)
    values(p_actor,p_id,'manual_palawan_rejected',jsonb_build_object('reason',trim(p_reason)));
end $$;
revoke all on function public.money_reject_palawan_deposit(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.money_reject_palawan_deposit(uuid,uuid,text) to service_role;


set local lock_timeout='10s';
alter table public.money_destinations drop constraint money_destinations_method_check;
alter table public.money_destinations add constraint money_destinations_method_check check(method in ('gcash','maya','gotyme'));
alter table public.money_destinations drop constraint money_destinations_account_number_check;
alter table public.money_destinations add constraint money_destinations_account_number_check check(
  (method in ('gcash','maya') and account_number ~ '^09[0-9]{9}$')
  or (method='gotyme' and account_number ~ '^[0-9]{6,20}$')
);
alter table public.money_transactions drop constraint money_transactions_method_check;
alter table public.money_transactions add constraint money_transactions_method_check check(
  (kind='deposit' and method in ('gcash','maya','qrph'))
  or (kind='withdrawal' and method in ('gcash','maya','gotyme'))
  or (kind not in ('deposit','withdrawal') and method='internal')
);
do $$
declare definition text:=pg_get_functiondef('public.money_request(uuid,text,bigint,text,uuid,uuid)'::regprocedure);
begin
  if strpos(definition, '(p_kind=''withdrawal'' and p_method not in (''gcash'',''maya''))')=0 then
    raise exception 'Unexpected money_request definition; review before migration';
  end if;
  execute replace(definition, '(p_kind=''withdrawal'' and p_method not in (''gcash'',''maya''))',
    '(p_kind=''withdrawal'' and p_method not in (''gcash'',''maya'',''gotyme''))');
end $$;

create function public.money_record_manual_gotyme(p_id uuid,p_actor uuid,p_reference text,p_status text,p_confirm boolean)
returns void language plpgsql security definer set search_path='' as $$
declare t public.money_transactions;
begin
  select * into strict t from public.money_transactions where id=p_id for update;
  if p_actor is null or p_actor=t.user_id or not exists(select 1 from public.profiles where id=p_actor and role='admin') then
    raise exception 'Independent administrator required';
  end if;
  if t.kind<>'withdrawal' or t.method<>'gotyme' or t.withdrawal_mode<>'admin_approval'
    or p_reference is null or p_reference !~ '^[A-Z0-9-]{5,80}$'
    or p_status is null or p_status not in ('succeeded','failed')
    or p_confirm is distinct from true then raise exception 'Invalid manual GoTyme confirmation'; end if;
  if t.provider_reference is not null and t.provider_reference is distinct from 'manual-gotyme:'||p_reference then
    raise exception 'Withdrawal already linked to a different transfer';
  end if;
  if t.status in ('completed','failed') then
    perform public.money_settle(p_id,'manual-gotyme:'||p_reference,p_status);
    return;
  end if;
  if t.status<>'processing' then raise exception 'Withdrawal must be claimed before recording transfer result'; end if;
  update public.money_transactions set provider_reference='manual-gotyme:'||p_reference where id=p_id;
  perform public.money_settle(p_id,'manual-gotyme:'||p_reference,p_status);
  insert into public.money_audit(actor_id,subject_id,action,details)
    values(p_actor,p_id,'manual_gotyme_result',jsonb_build_object('reference',p_reference,'status',p_status));
end $$;
revoke all on function public.money_record_manual_gotyme(uuid,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.money_record_manual_gotyme(uuid,uuid,text,text,boolean) to service_role;
notify pgrst,'reload schema';

-- Extend the existing manual flow to verified GCash and Maya recipients. No balance changes or external transfers.

create or replace function public.money_record_manual_gotyme(p_id uuid,p_actor uuid,p_reference text,p_status text,p_confirm boolean)
returns void language plpgsql security definer set search_path='' as $$
declare t public.money_transactions; transfer_ref text;
begin
  select * into strict t from public.money_transactions where id=p_id for update;
  if p_actor is null or p_actor=t.user_id or not exists(select 1 from public.profiles where id=p_actor and role='admin') then
    raise exception 'Independent administrator required';
  end if;
  if t.kind<>'withdrawal' or t.method not in ('gotyme','gcash','maya') or t.withdrawal_mode<>'admin_approval'
    or p_reference is null or p_reference !~ '^[A-Z0-9-]{5,80}$'
    or p_status is null or p_status not in ('succeeded','failed')
    or p_confirm is distinct from true then raise exception 'Invalid manual transfer confirmation'; end if;
  transfer_ref := 'manual-'||t.method||':'||p_reference;
  if t.provider_reference is not null and t.provider_reference is distinct from transfer_ref then
    raise exception 'Withdrawal already linked to a different transfer';
  end if;
  if t.status in ('completed','failed') then
    perform public.money_settle(p_id,transfer_ref,p_status);
    return;
  end if;
  if t.status<>'processing' then raise exception 'Withdrawal must be claimed before recording transfer result'; end if;
  update public.money_transactions set provider_reference=transfer_ref where id=p_id;
  perform public.money_settle(p_id,transfer_ref,p_status);
  insert into public.money_audit(actor_id,subject_id,action,details)
    values(p_actor,p_id,'manual_transfer_result',jsonb_build_object('method',t.method,'reference',p_reference,'status',p_status));
end $$;
revoke all on function public.money_record_manual_gotyme(uuid,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.money_record_manual_gotyme(uuid,uuid,text,text,boolean) to service_role;
notify pgrst,'reload schema';

-- Additive only. No opening cash, allocation, member credit or transfer is posted by this migration.

create table public.money_treasury_accounts(
 id text primary key check(id in ('palawan','gotyme')),
 balance bigint not null default 0 check(balance>=0),
 reconciled_at timestamptz, confirmed_by uuid references auth.users(id), reference text,
 updated_at timestamptz not null default now()
);
insert into public.money_treasury_accounts(id) values('palawan'),('gotyme');
create table public.money_treasury_entries(
 id uuid primary key default gen_random_uuid(),account_id text not null references public.money_treasury_accounts(id),
 entry_key text not null,kind text not null,transaction_id uuid references public.money_transactions(id),
 delta bigint not null,balance_after bigint not null check(balance_after>=0),
 reference text not null,occurred_at timestamptz not null,actor_id uuid not null references auth.users(id),
 details jsonb not null default '{}',created_at timestamptz not null default now(),unique(account_id,entry_key)
);
create unique index money_treasury_external_reference_once on public.money_treasury_entries(account_id,reference)
 where kind in ('deposit','payout','transfer_in','transfer_out');
alter table public.money_treasury_accounts enable row level security;
alter table public.money_treasury_entries enable row level security;
revoke all on public.money_treasury_accounts,public.money_treasury_entries from public,anon,authenticated,service_role;
grant select on public.money_treasury_accounts,public.money_treasury_entries to service_role;

create function public.money_treasury_summary() returns jsonb language sql stable security definer set search_path='' as $$
 with a as(select coalesce(sum(balance),0) cash,bool_and(reconciled_at is not null) ready from public.money_treasury_accounts),
 w as(select coalesce(sum(available::numeric+deposit_available+reserved+held),0) liabilities from public.money_wallets),
 b as(select available,reserved,sales from public.money_business_budget where id=true)
 select jsonb_build_object('ready',a.ready,'cash',a.cash,'liabilities',w.liabilities,
 'unallocated',greatest(0,a.cash-w.liabilities-b.available-b.reserved-b.sales),
 'rewardAvailable',b.available,'rewardReserved',b.reserved,'sales',b.sales,
 'shortfall',greatest(0,w.liabilities+b.available+b.reserved-a.cash),
 'accounts',(select jsonb_agg(jsonb_build_object('id',id,'balance',balance,'reconciled_at',reconciled_at,'reference',reference) order by id) from public.money_treasury_accounts)) from a,w,b;
$$;

create function public.money_treasury_post(p_account text,p_key text,p_kind text,p_tx uuid,p_delta bigint,p_reference text,p_at timestamptz,p_actor uuid,p_details jsonb default '{}')
returns void language plpgsql security definer set search_path='' as $$
declare a public.money_treasury_accounts; e public.money_treasury_entries;
begin
 if p_actor is null or not exists(select 1 from public.profiles where id=p_actor and role='admin') then raise exception 'Administrator required'; end if;
 if p_key is null or p_delta is null or p_at is null or p_at>clock_timestamp()+interval '1 minute' or length(trim(coalesce(p_reference,''))) not between 5 and 120 then raise exception 'Invalid cash entry'; end if;
 select * into strict a from public.money_treasury_accounts where id=p_account for update;
 if a.reconciled_at is null then raise exception 'Opening balances must be confirmed first'; end if;
 select * into e from public.money_treasury_entries where account_id=p_account and entry_key=p_key;
 if found then
  if e.delta<>p_delta or e.reference<>p_reference or e.transaction_id is distinct from p_tx or e.occurred_at<>p_at or e.kind<>p_kind then raise exception 'Cash entry conflict'; end if;
  return;
 end if;
 if a.balance+p_delta<0 then raise exception 'Cash ledger is insufficient; reconcile the actual source account'; end if;
 update public.money_treasury_accounts set balance=balance+p_delta,updated_at=now() where id=p_account;
 insert into public.money_treasury_entries(account_id,entry_key,kind,transaction_id,delta,balance_after,reference,occurred_at,actor_id,details)
 values(p_account,p_key,p_kind,p_tx,p_delta,a.balance+p_delta,p_reference,p_at,p_actor,p_details);
 insert into public.money_audit(actor_id,subject_id,action,details) values(p_actor,p_tx,'treasury_cash_entry',jsonb_build_object('account',p_account,'delta',p_delta,'kind',p_kind,'reference',p_reference));
end $$;

create function public.money_treasury_check_shortfall() returns void language plpgsql security definer set search_path='' as $$
declare s jsonb;
begin
 s:=public.money_treasury_summary();
 if (s->>'ready')::boolean then
  insert into public.money_alerts(key,severity,message,resolved,updated_at) values('manual-treasury-shortfall','critical','Reconciled cash is below existing member and funded reward obligations',(s->>'shortfall')::numeric=0,now())
  on conflict(key) do update set resolved=excluded.resolved,updated_at=now();
 end if;
end $$;

create function public.money_treasury_fund(p_actor uuid,p_amount bigint,p_key uuid,p_reference text,p_confirm boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare s jsonb;
begin
 if p_confirm is distinct from true then raise exception 'Business funding confirmation required'; end if;
 perform 1 from public.money_business_budget where id=true for update;
 perform 1 from public.money_treasury_accounts order by id for update;
 s:=public.money_treasury_summary();
 if not (s->>'ready')::boolean then raise exception 'Opening balances must be confirmed first'; end if;
 begin
  return public.money_business_fund(p_actor,p_amount,p_key,p_reference,'manual:palawan+gotyme',(s->>'cash')::bigint);
 exception when raise_exception then
  if sqlerrm='Insufficient unallocated verified PayMongo funds' then raise exception 'Insufficient unallocated recorded cash'; else raise; end if;
 end;
end $$;

create function public.money_treasury_open(p_actor uuid,p_palawan bigint,p_gotyme bigint,p_key uuid,p_reference text,p_at timestamptz,p_allocate boolean,p_confirm boolean,p_allocation_limit bigint default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.money_treasury_accounts; prior public.money_treasury_entries; s jsonb; allocation bigint:=0;
begin
 if p_actor is null or not exists(select 1 from public.profiles where id=p_actor and role='admin') then raise exception 'Administrator required'; end if;
 if p_confirm is distinct from true or p_palawan is null or p_gotyme is null or p_palawan<0 or p_gotyme<0 or p_palawan>100000000000 or p_gotyme>100000000000 or p_key is null or length(trim(coalesce(p_reference,''))) not between 5 and 100 or p_at is null or p_at>clock_timestamp()+interval '1 minute' or p_at<clock_timestamp()-interval '1 hour' then raise exception 'Confirm recent opening balances and statement reference'; end if;
 perform 1 from public.money_business_budget where id=true for update;
 perform 1 from public.money_treasury_accounts order by id for update;
 if exists(select 1 from public.money_treasury_accounts where reconciled_at is not null) then
  select * into prior from public.money_treasury_entries where account_id='palawan' and entry_key='opening:'||p_key;
  if found and prior.delta=p_palawan and prior.reference=p_reference and prior.occurred_at=p_at and prior.details=jsonb_build_object('allocate',p_allocate,'allocation_limit',p_allocation_limit) and exists(select 1 from public.money_treasury_entries where account_id='gotyme' and entry_key='opening:'||p_key and delta=p_gotyme) then return public.money_treasury_summary(); end if;
  raise exception 'Opening balances are already recorded; use reconciliation';
 end if;
 update public.money_treasury_accounts set reconciled_at=p_at,confirmed_by=p_actor,reference=p_reference,updated_at=now();
 perform public.money_treasury_post('palawan','opening:'||p_key,'opening',null,p_palawan,p_reference,p_at,p_actor,jsonb_build_object('allocate',p_allocate,'allocation_limit',p_allocation_limit));
 perform public.money_treasury_post('gotyme','opening:'||p_key,'opening',null,p_gotyme,p_reference,p_at,p_actor,jsonb_build_object('allocate',p_allocate,'allocation_limit',p_allocation_limit));
 s:=public.money_treasury_summary();
 if p_allocate is true then
  if p_allocation_limit is null or p_allocation_limit<10000 then raise exception 'Allocation limit must be at least PHP100'; end if;
  allocation:=least((s->>'unallocated')::bigint,100000000,p_allocation_limit);
  if allocation>=10000 then perform public.money_treasury_fund(p_actor,allocation,p_key,'treasury-opening:'||p_key,true); end if;
 end if;
 perform public.money_treasury_check_shortfall();
 return public.money_treasury_summary()||jsonb_build_object('allocated',case when allocation>=10000 then allocation else 0 end);
end $$;

create function public.money_treasury_approve_deposit(p_id uuid,p_actor uuid,p_reference text,p_received_at timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare t public.money_transactions; a public.money_treasury_accounts; prior public.money_treasury_entries; delta bigint;
begin
 perform 1 from public.money_business_budget where id=true for update;
 select user_id into strict t.user_id from public.money_transactions where id=p_id;
 perform pg_advisory_xact_lock(hashtextextended(t.user_id::text,0));
 select * into strict t from public.money_transactions where id=p_id for update;
 select * into strict a from public.money_treasury_accounts where id='palawan' for update;
 if a.reconciled_at is not null then
  if p_received_at is null or p_received_at>clock_timestamp()+interval '1 minute' or p_received_at<t.created_at-interval '90 days' then raise exception 'Enter the actual received payment time from PalawanPay history'; end if;
  delta:=case when p_received_at<=a.reconciled_at then 0 else t.amount end;
  select * into prior from public.money_treasury_entries where account_id='palawan' and entry_key='deposit:'||p_id;
  if found then delta:=prior.delta; elsif t.status='completed' then delta:=0; end if;
  perform public.money_treasury_post('palawan','deposit:'||p_id,'deposit',p_id,delta,'palawan:'||p_reference,p_received_at,p_actor,jsonb_build_object('amount',t.amount,'included_in_snapshot',delta=0));
 end if;
 perform public.money_approve_palawan_deposit(p_id,p_actor,p_reference);
end $$;

create function public.money_treasury_complete_payout(p_id uuid,p_actor uuid,p_reference text,p_status text,p_confirm boolean,p_sent_at timestamptz,p_sending_fee bigint default 0)
returns void language plpgsql security definer set search_path='' as $$
declare t public.money_transactions; a public.money_treasury_accounts; prior public.money_treasury_entries; delta bigint;
begin
 perform 1 from public.money_business_budget where id=true for update;
 select * into strict t from public.money_transactions where id=p_id for update;
 select * into strict a from public.money_treasury_accounts where id='gotyme' for update;
 if p_sending_fee is null or p_sending_fee<0 or p_sending_fee>100000 or (p_status='failed' and p_sending_fee<>0) then raise exception 'Invalid sending fee'; end if;
 if p_status='succeeded' and a.reconciled_at is not null then
  if p_sent_at is null or p_sent_at>clock_timestamp()+interval '1 minute' or p_sent_at<t.created_at then raise exception 'Enter the actual GoTyme transfer time'; end if;
  delta:=case when p_sent_at<=a.reconciled_at then 0 else -(t.amount-t.withdrawal_fee+p_sending_fee) end;
  select * into prior from public.money_treasury_entries where account_id='gotyme' and entry_key='payout:'||p_id;
  if found then
   if coalesce((prior.details->>'sending_fee')::bigint,0)<>p_sending_fee then raise exception 'Sending fee conflict'; end if;
   delta:=prior.delta;
  elsif t.status='completed' then delta:=0; end if;
  perform public.money_treasury_post('gotyme','payout:'||p_id,'payout',p_id,delta,'gotyme:'||p_reference,p_sent_at,p_actor,jsonb_build_object('net_sent',t.amount-t.withdrawal_fee,'sending_fee',p_sending_fee,'included_in_snapshot',delta=0));
 end if;
 perform public.money_record_manual_gotyme(p_id,p_actor,p_reference,p_status,p_confirm);
 perform public.money_treasury_check_shortfall();
end $$;

create function public.money_treasury_reconcile(p_actor uuid,p_account text,p_balance bigint,p_at timestamptz,p_reference text,p_key uuid,p_confirm boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.money_treasury_accounts; prior public.money_treasury_entries; s jsonb;
begin
 if p_actor is null or not exists(select 1 from public.profiles where id=p_actor and role='admin') or p_confirm is distinct from true then raise exception 'Administrator confirmation required'; end if;
 if p_balance is null or p_balance<0 or p_balance>100000000000 or p_key is null or p_at is null or p_at>clock_timestamp()+interval '1 minute' then raise exception 'Invalid reconciliation'; end if;
 perform 1 from public.money_business_budget where id=true for update;
 select * into strict a from public.money_treasury_accounts where id=p_account for update;
 select * into prior from public.money_treasury_entries where account_id=p_account and entry_key='reconcile:'||p_key;
 if found then
  if prior.balance_after<>p_balance or prior.reference<>p_reference or prior.occurred_at<>p_at then raise exception 'Reconciliation conflict'; end if;
  return public.money_treasury_summary();
 end if;
 if a.reconciled_at is null or p_at<a.reconciled_at or exists(select 1 from public.money_treasury_entries where account_id=p_account and occurred_at>p_at) then raise exception 'Use a current statement after the latest recorded movement'; end if;
 perform public.money_treasury_post(p_account,'reconcile:'||p_key,'reconcile',null,p_balance-a.balance,p_reference,p_at,p_actor);
 update public.money_treasury_accounts set reconciled_at=p_at,reference=p_reference,confirmed_by=p_actor where id=p_account;
 s:=public.money_treasury_summary();
 perform public.money_treasury_check_shortfall();
 return s;
end $$;

create function public.money_treasury_transfer(p_actor uuid,p_from text,p_to text,p_amount bigint,p_fee bigint,p_reference text,p_at timestamptz,p_key uuid,p_confirm boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_confirm is distinct from true or p_from=p_to or p_amount is null or p_amount<=0 or p_amount>100000000000 or p_fee is null or p_fee<0 or p_fee>100000 or p_key is null then raise exception 'Confirm the completed internal transfer'; end if;
 perform 1 from public.money_business_budget where id=true for update;
 perform 1 from public.money_treasury_accounts order by id for update;
 if exists(select 1 from public.money_treasury_accounts where reconciled_at is null or reconciled_at>=p_at) then raise exception 'Transfer must be after both reconciliation snapshots'; end if;
 perform public.money_treasury_post(p_from,'transfer-out:'||p_key,'transfer_out',null,-(p_amount+p_fee),p_from||':'||p_reference,p_at,p_actor,jsonb_build_object('to',p_to,'fee',p_fee));
 perform public.money_treasury_post(p_to,'transfer-in:'||p_key,'transfer_in',null,p_amount,p_to||':'||p_reference,p_at,p_actor,jsonb_build_object('from',p_from));
 perform public.money_treasury_check_shortfall();
 return public.money_treasury_summary();
end $$;

revoke all on function public.money_treasury_summary(),public.money_treasury_post(text,text,text,uuid,bigint,text,timestamptz,uuid,jsonb),public.money_treasury_fund(uuid,bigint,uuid,text,boolean),public.money_treasury_open(uuid,bigint,bigint,uuid,text,timestamptz,boolean,boolean,bigint),public.money_treasury_approve_deposit(uuid,uuid,text,timestamptz),public.money_treasury_complete_payout(uuid,uuid,text,text,boolean,timestamptz,bigint),public.money_treasury_reconcile(uuid,text,bigint,timestamptz,text,uuid,boolean),public.money_treasury_transfer(uuid,text,text,bigint,bigint,text,timestamptz,uuid,boolean) from public,anon,authenticated;
grant execute on function public.money_treasury_summary(),public.money_treasury_fund(uuid,bigint,uuid,text,boolean),public.money_treasury_open(uuid,bigint,bigint,uuid,text,timestamptz,boolean,boolean,bigint),public.money_treasury_approve_deposit(uuid,uuid,text,timestamptz),public.money_treasury_complete_payout(uuid,uuid,text,text,boolean,timestamptz,bigint),public.money_treasury_reconcile(uuid,text,bigint,timestamptz,text,uuid,boolean),public.money_treasury_transfer(uuid,text,text,bigint,bigint,text,timestamptz,uuid,boolean) to service_role;
revoke all on function public.money_treasury_post(text,text,text,uuid,bigint,text,timestamptz,uuid,jsonb),public.money_treasury_check_shortfall() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';


set local lock_timeout='10s';

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('withdrawal-payout-proofs','withdrawal-payout-proofs',false,5242880,array['image/png','image/jpeg'])
on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=array['image/png','image/jpeg'];

drop policy if exists "Deny client access to payout proof images" on storage.objects;
create policy "Deny client access to payout proof images" on storage.objects
  as restrictive for all to anon,authenticated
  using (bucket_id <> 'withdrawal-payout-proofs')
  with check (bucket_id <> 'withdrawal-payout-proofs');

alter table public.money_transactions
  add column payout_proof_path text,
  add column payout_confirmed_by uuid references auth.users(id),
  add column payout_confirmed_at timestamptz,
  add constraint money_payout_proof_path_unique unique(payout_proof_path),
  add constraint money_payout_proof_confirmation_check check (
    (payout_proof_path is null and payout_confirmed_by is null and payout_confirmed_at is null)
    or (kind='withdrawal' and status='completed' and payout_proof_path is not null
      and payout_confirmed_by is not null and payout_confirmed_at is not null)
  );

create function public.money_confirm_manual_payout(p_id uuid,p_actor uuid,p_proof_path text,p_confirm boolean)
returns void language plpgsql security definer set search_path='' as $$
declare
  t public.money_transactions;
  w public.money_wallets;
  confirmed_at timestamptz:=clock_timestamp();
  payout_reference text;
  net_amount bigint;
  cash_account public.money_treasury_accounts;
begin
  perform 1 from public.money_business_budget where id=true for update;
  select * into strict t from public.money_transactions where id=p_id for update;
  if p_actor is null or not exists(select 1 from public.profiles where id=p_actor and role='admin')
    or p_actor=t.user_id or p_actor=t.reviewed_by then
    raise exception 'Independent payout administrator required';
  end if;
  if p_confirm is distinct from true or p_proof_path is null
    or p_proof_path !~ ('^'||p_id::text||'/[0-9a-f-]{36}[.](png|jpg)$')
    or t.kind<>'withdrawal' or t.method not in ('gotyme','gcash','maya')
    or t.withdrawal_mode<>'admin_approval' or t.status<>'processing'
    or t.payout_proof_path is not null or t.payout_confirmed_at is not null then
    raise exception 'Invalid manual payout confirmation';
  end if;

  select * into strict w from public.money_wallets where user_id=t.user_id for update;
  if w.reserved<t.amount then raise exception 'Withdrawal reservation is missing'; end if;
  net_amount:=t.amount-t.withdrawal_fee;
  payout_reference:='proof-'||p_id::text;

  if t.method='gotyme' then
    select * into cash_account from public.money_treasury_accounts where id='gotyme' for update;
    if found and cash_account.reconciled_at is not null then
      perform public.money_treasury_post('gotyme','payout:'||p_id,'payout',p_id,-net_amount,
        payout_reference,confirmed_at,p_actor,jsonb_build_object('net_sent',net_amount,'proof_path',p_proof_path,'confirmation_time',confirmed_at));
    end if;
  end if;

  update public.money_wallets set reserved=reserved-t.amount where user_id=t.user_id;
  update public.money_transactions set status='completed',
    provider_reference='manual-proof:'||p_id::text,
    payout_proof_path=p_proof_path,payout_confirmed_by=p_actor,payout_confirmed_at=confirmed_at,
    updated_at=confirmed_at
    where id=p_id;
  insert into public.money_ledger(user_id,transaction_id,action,available_delta,reserved_delta)
    values(t.user_id,p_id,'settle',0,-t.amount);
  insert into public.money_audit(actor_id,subject_id,action,details)
    values(p_actor,p_id,'manual_payout_confirmed',jsonb_build_object(
      'proof_path',p_proof_path,'method',t.method,'requested_amount',t.amount,
      'fee',t.withdrawal_fee,'net_payout',net_amount,'confirmed_at',confirmed_at));

  perform public.money_treasury_check_shortfall();
end $$;

revoke all on function public.money_confirm_manual_payout(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.money_confirm_manual_payout(uuid,uuid,text,boolean) to service_role;
notify pgrst,'reload schema';


set local lock_timeout='10s';

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('manual-deposit-receipts','manual-deposit-receipts',false,5242880,array['image/png','image/jpeg'])
on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=array['image/png','image/jpeg'];

drop policy if exists "Deny client access to manual deposit receipts" on storage.objects;
create policy "Deny client access to manual deposit receipts" on storage.objects
  as restrictive for all to anon,authenticated
  using (bucket_id <> 'manual-deposit-receipts')
  with check (bucket_id <> 'manual-deposit-receipts');

alter table public.manual_qrph_deposits
  alter column receipt drop not null,
  add column receipt_path text,
  add column has_receipt boolean generated always as (receipt is not null or receipt_path is not null) stored,
  add constraint manual_qrph_receipt_path_unique unique(receipt_path),
  add constraint manual_qrph_receipt_path_check check (
    receipt_path is null or receipt_path ~ ('^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f]{64}[.](png|jpg)$')
  ),
  add constraint manual_qrph_receipt_present_check check (receipt is not null or receipt_path is not null);

create function public.money_submit_manual_qrph_private(
  p_user uuid,p_amount bigint,p_key uuid,p_reference text,p_receipt_path text
)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  deposit public.money_transactions;
  existing public.manual_qrph_deposits;
begin
  if p_user is null or p_key is null or p_reference is null
    or p_reference !~ '^(PALAWAN|GCASH)-[A-Z0-9-]{5,72}$'
    or p_receipt_path is null
    or p_receipt_path !~ ('^'||p_user::text||'/'||p_key::text||'/[0-9a-f]{64}[.](png|jpg)$') then
    raise exception 'Invalid manual deposit request';
  end if;

  deposit := public.money_request(p_user,'deposit',p_amount,'qrph',p_key,null);
  select * into strict deposit from public.money_transactions where id=deposit.id for update;
  if deposit.checkout_url is not null
    or (deposit.provider_reference is not null and deposit.provider_reference is distinct from 'manual-qrph:'||deposit.id) then
    raise exception 'Deposit is already linked to another payment flow';
  end if;

  select * into existing from public.manual_qrph_deposits where transaction_id=deposit.id for update;
  if found then
    if existing.instapay_reference<>p_reference or existing.receipt_path is distinct from p_receipt_path then
      raise exception 'Manual deposit request details changed';
    end if;
    return deposit.id;
  end if;
  if deposit.status<>'pending' then raise exception 'Deposit is already being processed'; end if;

  insert into public.manual_qrph_deposits(transaction_id,instapay_reference,receipt,receipt_path)
  values(deposit.id,p_reference,null,p_receipt_path);
  update public.money_transactions set provider_reference='manual-qrph:'||deposit.id
    where id=deposit.id and status='pending' and provider_reference is null;
  if not found then raise exception 'Deposit request is no longer pending'; end if;
  return deposit.id;
end $$;

revoke all on function public.money_submit_manual_qrph_private(uuid,bigint,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.money_submit_manual_qrph_private(uuid,bigint,uuid,text,text)
  to service_role;

create function public.money_reject_manual_qrph(p_id uuid,p_actor uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare
  deposit public.money_transactions;
  payment public.manual_qrph_deposits;
begin
  select * into strict deposit from public.money_transactions where id=p_id for update;
  if p_actor is null or p_actor=deposit.user_id
    or not exists(select 1 from public.profiles where id=p_actor and role='admin') then
    raise exception 'Independent administrator required';
  end if;
  if p_reason is null or length(trim(p_reason)) not between 5 and 500 then
    raise exception 'Invalid rejection reason';
  end if;
  if deposit.kind<>'deposit' or deposit.method<>'qrph'
    or deposit.provider_reference is distinct from 'manual-qrph:'||deposit.id then
    raise exception 'Invalid manual deposit';
  end if;
  select * into strict payment from public.manual_qrph_deposits where transaction_id=p_id;
  if payment.instapay_reference !~ '^(PALAWAN|GCASH)-' then
    raise exception 'Unsupported manual deposit channel';
  end if;
  if deposit.status='rejected' then return; end if;
  if deposit.status<>'pending' then raise exception 'Deposit already reviewed'; end if;

  update public.money_transactions set status='rejected',reviewed_by=p_actor,updated_at=clock_timestamp()
    where id=p_id;
  insert into public.money_audit(actor_id,subject_id,action,details)
    values(p_actor,p_id,'manual_deposit_rejected',jsonb_build_object(
      'reason',trim(p_reason),'channel',split_part(payment.instapay_reference,'-',1)));
end $$;

revoke all on function public.money_reject_manual_qrph(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.money_reject_manual_qrph(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';

-- Scope the opening update for Supabase API sessions with safeupdate enabled.

set local lock_timeout = '10s';

create or replace function public.money_treasury_open(p_actor uuid,p_palawan bigint,p_gotyme bigint,p_key uuid,p_reference text,p_at timestamptz,p_allocate boolean,p_confirm boolean,p_allocation_limit bigint default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.money_treasury_accounts; prior public.money_treasury_entries; s jsonb; allocation bigint:=0;
begin
 if p_actor is null or not exists(select 1 from public.profiles where id=p_actor and role='admin') then raise exception 'Administrator required'; end if;
 if p_confirm is distinct from true or p_palawan is null or p_gotyme is null or p_palawan<0 or p_gotyme<0 or p_palawan>100000000000 or p_gotyme>100000000000 or p_key is null or length(trim(coalesce(p_reference,''))) not between 5 and 100 or p_at is null or p_at>clock_timestamp()+interval '1 minute' or p_at<clock_timestamp()-interval '1 hour' then raise exception 'Confirm recent opening balances and statement reference'; end if;
 perform 1 from public.money_business_budget where id=true for update;
 perform 1 from public.money_treasury_accounts order by id for update;
 if exists(select 1 from public.money_treasury_accounts where reconciled_at is not null) then
  select * into prior from public.money_treasury_entries where account_id='palawan' and entry_key='opening:'||p_key;
  if found and prior.delta=p_palawan and prior.reference=p_reference and prior.occurred_at=p_at and prior.details=jsonb_build_object('allocate',p_allocate,'allocation_limit',p_allocation_limit) and exists(select 1 from public.money_treasury_entries where account_id='gotyme' and entry_key='opening:'||p_key and delta=p_gotyme) then return public.money_treasury_summary(); end if;
  raise exception 'Opening balances are already recorded; use reconciliation';
 end if;
 update public.money_treasury_accounts set reconciled_at=p_at,confirmed_by=p_actor,reference=p_reference,updated_at=now()
 where id in ('palawan','gotyme') and reconciled_at is null;
 perform public.money_treasury_post('palawan','opening:'||p_key,'opening',null,p_palawan,p_reference,p_at,p_actor,jsonb_build_object('allocate',p_allocate,'allocation_limit',p_allocation_limit));
 perform public.money_treasury_post('gotyme','opening:'||p_key,'opening',null,p_gotyme,p_reference,p_at,p_actor,jsonb_build_object('allocate',p_allocate,'allocation_limit',p_allocation_limit));
 s:=public.money_treasury_summary();
 if p_allocate is true then
  if p_allocation_limit is null or p_allocation_limit<10000 then raise exception 'Allocation limit must be at least PHP100'; end if;
  allocation:=least((s->>'unallocated')::bigint,100000000,p_allocation_limit);
  if allocation>=10000 then perform public.money_treasury_fund(p_actor,allocation,p_key,'treasury-opening:'||p_key,true); end if;
 end if;
 perform public.money_treasury_check_shortfall();
 return public.money_treasury_summary()||jsonb_build_object('allocated',case when allocation>=10000 then allocation else 0 end);
end $$;


commit;
