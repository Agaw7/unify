-- One-time reset requested by the owner. NOT a migration or launch prerequisite.
-- Preserves only the explicitly selected administrator and all product plans.
-- Change ROLLBACK to COMMIT only for the owner-approved final execution.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';
lock table auth.users in share row exclusive mode;
do $$
declare
  keep_id constant uuid := 'fc955312-fb86-48e6-b4d4-4163c947c2bc';
  products_before jsonb;
begin
  if not exists(select 1 from auth.users u join public.profiles p on p.id=u.id
    where u.id=keep_id and u.phone in ('639157471830','09157471830') and p.role='admin') then
    raise exception 'Preserved administrator does not match';
  end if;
  if (select count(*) from auth.users) <> 7 then
    raise exception 'Account count changed; inspect scope again';
  end if;
  if exists(select 1 from public.money_transactions)
    or exists(select 1 from public.money_ledger)
    or exists(select 1 from public.money_customers)
    or exists(select 1 from public.money_wallets)
    or exists(select 1 from public.money_destinations)
    or exists(select 1 from public.money_audit)
    or exists(select 1 from public.money_events) then
    raise exception 'Live-payment records exist; aborting test reset';
  end if;
  select jsonb_agg(to_jsonb(p) order by p.id) into products_before
    from public.investment_products p;
  if jsonb_array_length(products_before) <> 8 then
    raise exception 'Product catalog changed; inspect again';
  end if;

  -- Explicit list, no CASCADE: an unexpected dependency aborts the transaction.
  truncate table public.sandbox_free_plan_grants,
    public.sandbox_referral_commissions, public.simulation_daily_credits,
    public.daily_team_task_claims, public.sandbox_earnings_ledger,
    public.sandbox_bonus_ledger, public.sandbox_withdrawal_payouts,
    public.sandbox_withdrawal_requests, public.withdrawal_payout_confirmations,
    public.withdrawal_requests, public.webhook_events, public.wallet_ledger,
    public.payment_transactions, public.demo_investments, public.team_members,
    public.unify_sandbox_transactions, public.unify_sandbox_wallets,
    public.sandbox_deposit_balances, public.sandbox_wallets,
    public.simulation_wallets, public.wallet_accounts;

  delete from public.sandbox_withdrawal_mode_audit where actor_id<>keep_id;
  update public.sandbox_withdrawal_settings set updated_by=keep_id
    where updated_by is not null and updated_by<>keep_id;
  delete from public.payment_accounts where user_id<>keep_id;
  delete from public.admin_users where user_id<>keep_id;
  delete from auth.users where id<>keep_id;
  insert into public.sandbox_wallets(user_id,remaining_balance,currency)
    values(keep_id,0,'PHP');
  insert into public.wallet_accounts(user_id,balance,currency)
    values(keep_id,0,'PHP');

  if (select count(*) from auth.users)<>1
    or not exists(select 1 from public.profiles where id=keep_id and role='admin')
    or products_before is distinct from
      (select jsonb_agg(to_jsonb(p) order by p.id) from public.investment_products p) then
    raise exception 'Post-reset validation failed';
  end if;
end $$;
select (select count(*) from auth.users) accounts_remaining,
  (select count(*) from public.investment_products) products_preserved,
  (select count(*) from public.payment_transactions) test_transactions,
  (select count(*) from public.demo_investments) test_investments,
  (select count(*) from public.sandbox_referral_commissions) test_commissions;
rollback;
