-- Requires migrations 03,04,15,16,17,18. No sandbox money is imported.
begin;
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
commit;
