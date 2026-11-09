begin;
-- Test purchases can spend both test wallets; live PHP funds remain separate.
-- Spend Remaining Balance first, then cover any shortfall from Deposit Balance.
create or replace function public.purchase_demo_investment(p_product_id uuid,p_amount numeric)
returns uuid language plpgsql security definer set search_path='' as $$
declare
 v_user uuid:=auth.uid(); v_price numeric; v_daily numeric; v_deposit numeric:=0;
 v_remaining numeric:=0; v_from_remaining numeric; v_from_deposit numeric; v_id uuid;
begin
 if v_user is null then raise exception 'Authentication required'; end if;
 if p_product_id is null or p_amount is null or p_amount<=0 or p_amount>100000 or p_amount<>round(p_amount,2) then
   raise exception 'Invalid investment details'; end if;
 select price,daily_income into v_price,v_daily from public.investment_products where id=p_product_id;
 if not found then raise exception 'Investment product not found'; end if;
 if p_amount<>v_price then raise exception 'Investment amount does not match product price'; end if;
 -- Consistent lock order serializes purchases, deposits, and withdrawal reservations.
 select balance into v_deposit from public.wallet_accounts where user_id=v_user and currency='PHP' for update;
 if not found then v_deposit:=0; end if;
 select remaining_balance into v_remaining from public.sandbox_wallets where user_id=v_user and currency='PHP' for update;
 if not found then v_remaining:=0; end if;
 if v_remaining is null or v_deposit is null or v_remaining<0 or v_deposit<0 then raise exception 'Invalid test wallet balance'; end if;
 if v_remaining+v_deposit<v_price then raise exception 'Insufficient combined test balance'; end if;
 v_from_remaining:=least(v_remaining,v_price);
 v_from_deposit:=v_price-v_from_remaining;
 if v_from_remaining>0 then
   update public.sandbox_wallets set remaining_balance=remaining_balance-v_from_remaining where user_id=v_user and currency='PHP';
 end if;
 if v_from_deposit>0 then
   update public.wallet_accounts set balance=balance-v_from_deposit where user_id=v_user and currency='PHP';
 end if;
 insert into public.demo_investments(user_id,product_id,amount,daily_income)
 values(v_user,p_product_id,v_price,v_daily) returning id into v_id;
 return v_id;
end; $$;
revoke all on function public.purchase_demo_investment(uuid,numeric) from public,anon;
grant execute on function public.purchase_demo_investment(uuid,numeric) to authenticated;
notify pgrst,'reload schema';
commit;
