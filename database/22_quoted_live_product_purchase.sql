-- Requires migration 19. Server-only live purchase with locked, accepted terms.
begin;
create or replace function public.money_investment_purchase_quoted(
 p_user uuid,p_product uuid,p_key uuid,p_expected_price bigint,p_expected_daily bigint,p_expected_duration integer
) returns public.money_investments language plpgsql security definer set search_path='' as $$
declare prior public.money_investments; product record;
begin
 if p_user is null or p_product is null or p_key is null or p_expected_price is null or p_expected_daily is null
 or p_expected_price<1 or p_expected_daily<1 or p_expected_duration is distinct from 365 then raise exception 'Valid accepted purchase terms required'; end if;
 perform 1 from public.money_business_budget where id=true for update;
 if not found then raise exception 'Business rewards budget is not configured'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 select * into prior from public.money_investments where user_id=p_user and idempotency_key=p_key;
 if found then
  if prior.product_id<>p_product or prior.acquisition<>'purchase' or prior.price<>p_expected_price
  or prior.daily_amount<>p_expected_daily or prior.duration_days<>p_expected_duration then raise exception 'Plan request conflict'; end if;
  return prior;
 end if;
 select price,daily_income into product from public.investment_products where id=p_product for share;
 if not found then raise exception 'Product unavailable'; end if;
 if product.price*100 is distinct from p_expected_price::numeric or product.daily_income*100 is distinct from p_expected_daily::numeric then
  raise exception 'Product terms changed; refresh and accept the updated price before purchasing';
 end if;
 return public.money_investment_open(p_user,p_product,p_key,null,'Accepted live-plan terms v1: 365 daily claims; purchase price is not automatically returned.');
end $$;
revoke all on function public.money_investment_purchase_quoted(uuid,uuid,uuid,bigint,bigint,integer) from public,anon,authenticated;
grant execute on function public.money_investment_purchase_quoted(uuid,uuid,uuid,bigint,bigint,integer) to service_role;
notify pgrst,'reload schema';
commit;
