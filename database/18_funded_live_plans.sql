-- Requires 03,04,16,17. New live contracts only. Existing demo funds/contracts are never imported.
begin;
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
commit;
