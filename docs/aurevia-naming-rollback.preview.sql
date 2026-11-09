-- REVIEW ONLY. Restore the pre-change application release before running.
-- RESTRICT fails if a later database object still depends on an alias.
begin;
set local lock_timeout = '5s';

drop view public.practice_transaction_records restrict;
drop view public.practice_transfer_wallets restrict;
drop view public.practice_wallet_accounts restrict;
drop view public.investment_records restrict;
drop view public.free_plan_grants restrict;

notify pgrst, 'reload schema';
commit;
