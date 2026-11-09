-- REVIEW ONLY. Apply on an isolated restored staging database first.
-- Add read names for existing practice records. PostgreSQL 15+ is required.
begin;
set local lock_timeout = '5s';

do $$
begin
  if current_setting('server_version_num')::integer < 150000 then
    raise exception 'Security invoker views require PostgreSQL 15 or newer';
  end if;
  if (select count(*) from pg_class
      where relnamespace = 'public'::regnamespace
        and relkind in ('r', 'p')
        and relrowsecurity
        and relname in ('sandbox_free_plan_grants', 'demo_investments',
                       'sandbox_wallets', 'unify_sandbox_wallets',
                       'unify_sandbox_transactions')) <> 5 then
    raise exception 'Expected five existing RLS-protected practice tables';
  end if;
end $$;

create view public.free_plan_grants with (security_invoker = true) as
select id, user_id, product_id, investment_id, granted_by, idempotency_key,
       note, created_at, 'sandbox'::text as record_origin
from public.sandbox_free_plan_grants;

create view public.investment_records with (security_invoker = true) as
select id, user_id, product_id, amount, daily_income, acquisition_type,
       created_at, 'sandbox'::text as record_origin
from public.demo_investments;

create view public.practice_wallet_accounts with (security_invoker = true) as
select user_id, remaining_balance as recorded_balance, currency, created_at,
       'sandbox'::text as record_origin
from public.sandbox_wallets;

create view public.practice_transfer_wallets with (security_invoker = true) as
select user_id, balance_centavos, 'sandbox'::text as record_origin
from public.unify_sandbox_wallets;

create view public.practice_transaction_records with (security_invoker = true) as
select id, user_id, transaction_type, amount_centavos, balance_after_centavos,
       created_at, 'sandbox'::text as record_origin
from public.unify_sandbox_transactions;

revoke all on public.free_plan_grants, public.investment_records,
  public.practice_wallet_accounts, public.practice_transfer_wallets,
  public.practice_transaction_records from public, anon, authenticated, service_role;

grant select on public.free_plan_grants, public.investment_records,
  public.practice_wallet_accounts, public.practice_transfer_wallets,
  public.practice_transaction_records to authenticated, service_role;

comment on view public.free_plan_grants is 'Historical practice grants. Funded grants are tracked separately.';
comment on view public.investment_records is 'Historical practice investments. Funded investment records are tracked separately.';

notify pgrst, 'reload schema';
commit;
