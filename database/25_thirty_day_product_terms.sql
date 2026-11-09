-- Sets new offer terms. Existing contracts retain their stored terms and funding.
begin;
alter table public.investment_products add column if not exists duration_days integer not null default 365 check(duration_days between 1 and 365);
do $$
declare changed integer;
begin
  update public.investment_products as p
  set price = terms.price, daily_income = terms.daily, duration_days = 30
  from (values
    ('G5 Pro 4K Camera', 300, 30),
    ('UNVR 4-Bay NVR', 800, 84),
    ('G4 Doorbell Pro', 1500, 166),
    ('UniFi U6 Pro AP', 3000, 340),
    ('G5 Bullet Camera', 5000, 576),
    ('G5 Dome Camera', 8000, 990),
    ('G5 Flex Camera', 15000, 1992)
  ) as terms(name, price, daily)
  where p.name = terms.name;
  get diagnostics changed = row_count;
  if changed <> 7 then raise exception 'Expected seven catalog products, found %', changed; end if;
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
 price:=(product.price*100)::bigint;daily:=(product.daily_income*100)::bigint;cost:=daily*product.duration_days;
 if price>100000000000 or cost>100000000000 or b.available<cost then raise exception 'Insufficient funded business rewards budget for this plan'; end if;
 if p_actor is null then
 select * into strict w from public.money_wallets where user_id=p_user for update;
 if w.available::numeric+w.deposit_available<price then raise exception 'Insufficient available balance'; end if;
 from_deposit=least(w.deposit_available,price);from_available=price-from_deposit;
 update public.money_wallets set deposit_available=deposit_available-from_deposit,available=available-from_available where user_id=p_user;
 insert into public.money_transactions(user_id,kind,amount,method,status,idempotency_key) values(p_user,'investment_purchase',price,'internal','completed',p_key) returning id into tx;
 insert into public.money_ledger(user_id,transaction_id,action,available_delta,reserved_delta,deposit_delta) values(p_user,tx,'plan_purchase',-from_available,0,-from_deposit);
 end if;
 insert into public.money_investments(user_id,product_id,name,price,daily_amount,duration_days,acquisition,granted_by,note,idempotency_key) values(p_user,p_product,product.name,price,daily,product.duration_days,v_acquisition,p_actor,coalesce(p_note,''),p_key) returning * into inv;
 update public.money_business_budget set available=available-cost,reserved=reserved+cost,sales=sales+case when p_actor is null then price else 0 end where id=true;
 insert into public.money_business_ledger(action,subject_id,available_delta,reserved_delta,sales_delta) values(v_acquisition,inv.id,-cost,cost,case when p_actor is null then price else 0 end);
 insert into public.money_audit(actor_id,subject_id,action,details) values(coalesce(p_actor,p_user),inv.id,'live_plan_'||v_acquisition,jsonb_build_object('user',p_user,'product',p_product,'reserved_rewards',cost,'days',product.duration_days));
 return inv;
end $$;

create or replace function public.money_investment_purchase_quoted(
 p_user uuid,p_product uuid,p_key uuid,p_expected_price bigint,p_expected_daily bigint,p_expected_duration integer
) returns public.money_investments language plpgsql security definer set search_path='' as $$
declare prior public.money_investments; product record;
begin
 if p_user is null or p_product is null or p_key is null or p_expected_price is null or p_expected_daily is null
 or p_expected_price<1 or p_expected_daily<1 or p_expected_duration is null or p_expected_duration not between 1 and 365 then raise exception 'Valid accepted purchase terms required'; end if;
 perform 1 from public.money_business_budget where id=true for update;
 if not found then raise exception 'Business rewards budget is not configured'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 select * into prior from public.money_investments where user_id=p_user and idempotency_key=p_key;
 if found then
  if prior.product_id<>p_product or prior.acquisition<>'purchase' or prior.price<>p_expected_price
  or prior.daily_amount<>p_expected_daily or prior.duration_days<>p_expected_duration then raise exception 'Plan request conflict'; end if;
  return prior;
 end if;
 select price,daily_income,duration_days into product from public.investment_products where id=p_product for share;
 if not found then raise exception 'Product unavailable'; end if;
 if product.price*100 is distinct from p_expected_price::numeric or product.daily_income*100 is distinct from p_expected_daily::numeric or product.duration_days is distinct from p_expected_duration then
  raise exception 'Product terms changed; refresh and accept the updated price before purchasing';
 end if;
 return public.money_investment_open(p_user,p_product,p_key,null,'Accepted displayed live-plan terms; purchase price is not automatically returned.');
end $$;
revoke all on function public.money_investment_purchase_quoted(uuid,uuid,uuid,bigint,bigint,integer) from public,anon,authenticated;
grant execute on function public.money_investment_purchase_quoted(uuid,uuid,uuid,bigint,bigint,integer) to service_role;

notify pgrst,'reload schema';
commit;
