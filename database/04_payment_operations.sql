-- Apply once AFTER 03_real_money.sql. Integer centavos throughout.
begin;
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
commit;
