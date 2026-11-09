begin;

-- Sandbox product purchases use the same remaining balance displayed by UNIFY.
-- The existing test-deposit and live PHP wallets are separate.
create or replace function public.purchase_demo_investment(p_product_id uuid, p_amount numeric)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_price numeric;
  v_daily_income numeric;
  v_balance numeric;
  v_investment_id uuid;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_product_id is null or p_amount is null or p_amount <= 0
     or p_amount > 100000 or p_amount <> round(p_amount, 2) then
    raise exception 'Invalid investment details';
  end if;
  select price, daily_income into v_price, v_daily_income
  from public.investment_products where id = p_product_id;
  if not found then raise exception 'Investment product not found'; end if;
  if p_amount <> v_price then raise exception 'Investment amount does not match product price'; end if;

  -- Serialize purchases and withdrawal reservations against the same wallet.
  select remaining_balance into v_balance from public.sandbox_wallets
  where user_id = v_user_id and currency = 'PHP' for update;
  if not found then raise exception 'Test wallet not found'; end if;
  if v_balance < v_price then raise exception 'Insufficient Remaining Balance (Test Mode)'; end if;

  update public.sandbox_wallets set remaining_balance = remaining_balance - v_price
  where user_id = v_user_id;
  insert into public.demo_investments(user_id, product_id, amount, daily_income)
  values(v_user_id, p_product_id, v_price, v_daily_income) returning id into v_investment_id;
  return v_investment_id;
end;
$$;
revoke all on function public.purchase_demo_investment(uuid,numeric) from public,anon;
grant execute on function public.purchase_demo_investment(uuid,numeric) to authenticated;
notify pgrst, 'reload schema';
commit;
