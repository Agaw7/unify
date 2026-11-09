-- READ-ONLY DRY RUN ONLY. This file contains no DELETE, UPDATE, or DDL.
-- Before running, independently confirm the Supabase dashboard URL is for
-- project yjuliuehlgzmpxoetefn (user-confirmed non-production test project).
-- Expected retained admin: fc955312-fb86-48e6-b4d4-4163c947c2bc.
-- Selected candidate tables for a future, separately approved plan:
-- sandbox_free_plan_grants and demo_investments only.
-- Counts are valid only when the PREFLIGHT row reports PASS.
-- Financial ledgers, audit trails, payout confirmations, business accounting,
-- and webhook evidence are reported as protected, not as deletion candidates.

with
admin_guard as (
  select
    count(*) = 1
      and coalesce(bool_or(id = 'fc955312-fb86-48e6-b4d4-4163c947c2bc'::uuid), false) as valid
  from public.profiles
  where role = 'admin'
),
test_members as (
  select p.id
  from public.profiles p
  cross join admin_guard g
  where g.valid
    and p.role = 'user'
    and p.id <> 'fc955312-fb86-48e6-b4d4-4163c947c2bc'::uuid
),
member_money_transactions as (
  select id from public.money_transactions
  where user_id in (select id from test_members)
),
member_payment_transactions as (
  select id from public.payment_transactions
  where user_id in (select id from test_members)
),
member_withdrawals as (
  select id from public.withdrawal_requests
  where user_id in (select id from test_members)
),
member_sandbox_withdrawals as (
  select id from public.sandbox_withdrawal_requests
  where user_id in (select id from test_members)
),
member_manual_requests as (
  select id from public.manual_test_requests
  where user_id in (select id from test_members)
),
member_money_investments as (
  select id from public.money_investments
  where user_id in (select id from test_members)
),
member_ids as (
  select id from test_members
),
protected_member_accounts as (
  select user_id as id from public.money_transactions
  where user_id in (select id from test_members)
  union
  select user_id as id from public.money_ledger
  where user_id in (select id from test_members)
  union
  select user_id as id from public.wallet_ledger
  where user_id in (select id from test_members)
  union
  select user_id as id from public.sandbox_bonus_ledger
  where user_id in (select id from test_members)
  union
  select user_id as id from public.sandbox_earnings_ledger
  where user_id in (select id from test_members)
  union
  select user_id as id from public.unify_sandbox_transactions
  where user_id in (select id from test_members)
),
preflight as (
  select
    g.valid,
    (select id from public.profiles where role = 'admin' limit 1) as admin_id,
    (select count(*) from test_members) as member_count,
    (select count(*) from protected_member_accounts) as protected_member_count
  from admin_guard g
),
report as (
  select
    'PREFLIGHT'::text as table_name,
    'GUARD'::text as scope,
    case when valid then 1 else 0 end::bigint as row_count,
    format(
      'status=%s; admin_id=%s; non-admin member profiles=%s',
      case when valid then 'PASS' else 'FAIL' end,
      coalesce(admin_id::text, 'missing'),
      member_count
    ) || format(
      '; members with protected audit=%s; members not directly linked to these ledgers=%s',
      protected_member_count,
      greatest(member_count - protected_member_count, 0)
    ) as notes
  from preflight

  union all
  select 'auth.users', 'RETAINED ACCOUNT; NO DELETE', count(*), 'All eight member accounts are linked to protected test financial ledgers.'
  from auth.users where id in (select id from test_members)
  union all
  select 'public.profiles', 'RETAINED ACCOUNT; NO DELETE', count(*), 'Member profiles remain because linked financial audit is retained.'
  from public.profiles where id in (select id from test_members)
  union all
  select 'public.team_members', 'VIEW; NOT DELETABLE', count(*), 'Derived from profiles; changing it requires separate profile/invite updates.'
  from public.team_members where id in (select id from member_ids) or invited_by in (select id from member_ids)
  union all
  select
    'public.demo_investments',
    'SELECTED CANDIDATE; NONFINANCIAL TEST DATA',
    count(*),
    format(
      'Member-owned demo investments; record_ids=%s',
      coalesce(
        (select string_agg(id::text, ', ' order by id)
         from public.demo_investments where user_id in (select id from member_ids)),
        'none'
      )
    )
  from public.demo_investments where user_id in (select id from member_ids)
  union all
  select 'public.payment_transactions', 'CANDIDATE TRANSACTION DATA', count(*), 'Member-owned payment records; inspect FK dependencies before any deletion.'
  from public.payment_transactions where user_id in (select id from member_ids)
  union all
  select 'public.wallet_accounts', 'PROTECTED FINANCIAL STATE', count(*), 'Retain balances; do not reset outside an audited ledger operation.'
  from public.wallet_accounts where user_id in (select id from member_ids)
  union all
  select 'public.wallet_ledger', 'PROTECTED FINANCIAL AUDIT', count(*), 'Preserve ledger entries for reconciliation.'
  from public.wallet_ledger where user_id in (select id from member_ids)
  union all
  select 'public.money_transactions', 'PROTECTED FINANCIAL HISTORY', count(*), 'Do not delete while preserving linked ledger/audit records.'
  from public.money_transactions where user_id in (select id from member_ids)
  union all
  select 'public.money_wallets', 'PROTECTED FINANCIAL STATE', count(*), 'Retain balances/reservations consistent with the immutable ledger.'
  from public.money_wallets where user_id in (select id from member_ids)
  union all
  select 'public.money_ledger', 'PROTECTED FINANCIAL AUDIT', count(*), 'Preserve immutable financial ledger entries.'
  from public.money_ledger where user_id in (select id from member_ids)
  union all
  select 'public.manual_qrph_deposits', 'PROTECTED PAYMENT EVIDENCE', count(*), 'Receipt/evidence rows linked to member transactions.'
  from public.manual_qrph_deposits where transaction_id in (select id from member_money_transactions)
  union all
  select 'public.withdrawal_requests', 'CANDIDATE REQUEST DATA; FK REVIEW REQUIRED', count(*), 'Member withdrawal requests.'
  from public.withdrawal_requests where user_id in (select id from member_ids)
  union all
  select 'public.sandbox_withdrawal_requests', 'CANDIDATE TEST REQUEST DATA', count(*), 'Sandbox requests only.'
  from public.sandbox_withdrawal_requests where user_id in (select id from member_ids)
  union all
  select
    'public.sandbox_free_plan_grants',
    'SELECTED CANDIDATE; NONFINANCIAL TEST DATA',
    count(*),
    format(
      'Delete grants before referenced demo investments; grant_id -> investment_id: %s',
      coalesce(
        (select string_agg(format('%s -> %s', id, investment_id), ', ' order by id)
         from public.sandbox_free_plan_grants where user_id in (select id from member_ids)),
        'none'
      )
    )
  from public.sandbox_free_plan_grants where user_id in (select id from member_ids)
  union all
  select 'public.sandbox_referral_commissions', 'PROTECTED TEST REWARD HISTORY', count(*), 'Keep commission history for audit/reconciliation.'
  from public.sandbox_referral_commissions
  where beneficiary_id in (select id from member_ids) or depositor_id in (select id from member_ids)
  union all
  select 'public.sandbox_wallets', 'PROTECTED TEST FINANCIAL STATE', count(*), 'Retain balances consistent with sandbox ledgers.'
  from public.sandbox_wallets where user_id in (select id from member_ids)
  union all
  select 'public.sandbox_bonus_ledger', 'PROTECTED TEST LEDGER', count(*), 'Review retention before any cleanup; do not delete in this dry run.'
  from public.sandbox_bonus_ledger where user_id in (select id from member_ids)
  union all
  select 'public.sandbox_earnings_ledger', 'PROTECTED TEST LEDGER', count(*), 'Review retention before any cleanup; do not delete in this dry run.'
  from public.sandbox_earnings_ledger where user_id in (select id from member_ids)
  union all
  select 'public.unify_sandbox_transactions', 'PROTECTED TEST LEDGER', count(*), 'Review retention before any cleanup; do not delete in this dry run.'
  from public.unify_sandbox_transactions where user_id in (select id from member_ids)
  union all
  select 'public.unify_sandbox_wallets', 'PROTECTED TEST FINANCIAL STATE', count(*), 'Retain balances consistent with sandbox history.'
  from public.unify_sandbox_wallets where user_id in (select id from member_ids)
  union all
  select 'public.simulation_wallets', 'CANDIDATE TEST WALLET STATE', count(*), 'Member simulation wallets.'
  from public.simulation_wallets where user_id in (select id from member_ids)
  union all
  select 'public.simulation_daily_credits', 'CANDIDATE TEST ACTIVITY', count(*), 'Member simulation credits.'
  from public.simulation_daily_credits where user_id in (select id from member_ids)
  union all
  select 'public.money_promo_claims', 'PROTECTED REWARD AUDIT', count(*), 'Claims link to credited money transactions; retain for reconciliation.'
  from public.money_promo_claims where user_id in (select id from member_ids)
  union all
  select 'public.money_referral_commissions', 'PROTECTED REWARD AUDIT', count(*), 'Keep commission history for ledger reconciliation.'
  from public.money_referral_commissions
  where beneficiary_id in (select id from member_ids) or depositor_id in (select id from member_ids)
  union all
  select 'public.money_daily_task_claims', 'PROTECTED REWARD AUDIT', count(*), 'Claims link to credited money transactions.'
  from public.money_daily_task_claims where user_id in (select id from member_ids)
  union all
  select 'public.daily_team_task_claims', 'CANDIDATE TEST REWARD DATA', count(*), 'Member team task claims.'
  from public.daily_team_task_claims where user_id in (select id from member_ids)
  union all
  select 'public.money_investments', 'CANDIDATE TEST MEMBERSHIP DATA', count(*), 'Member plan records.'
  from public.money_investments where user_id in (select id from member_ids)
  union all
  select 'public.money_investment_claims', 'PROTECTED REWARD AUDIT', count(*), 'Claims link to credited money transactions.'
  from public.money_investment_claims where investment_id in (select id from member_money_investments)
  union all
  select 'public.money_registration_bonuses', 'PROTECTED FINANCIAL AUDIT', count(*), 'Preserve bonus issuance/reversal history for reconciliation.'
  from public.money_registration_bonuses where user_id in (select id from member_ids)
  union all
  select 'public.money_registration_bonus_queue', 'PROTECTED REWARD OPERATIONS', count(*), 'Keep queue/idempotency state associated with issued bonuses.'
  from public.money_registration_bonus_queue where user_id in (select id from member_ids)
  union all
  select 'public.money_verifications', 'CANDIDATE MEMBER DATA', count(*), 'Member-owned verification rows; preserve admin reviewer evidence.'
  from public.money_verifications where user_id in (select id from member_ids)
  union all
  select 'public.money_destinations', 'CANDIDATE MEMBER DATA', count(*), 'Member withdrawal destinations.'
  from public.money_destinations where user_id in (select id from member_ids)
  union all
  select 'public.payment_accounts', 'NOT SELECTED; RETAIN', count(*), 'Excluded from the current candidate scope.'
  from public.payment_accounts where user_id in (select id from member_ids)
  union all
  select 'public.manual_test_requests', 'CANDIDATE TEST REQUEST DATA', count(*), 'Member-owned manual-test requests.'
  from public.manual_test_requests where user_id in (select id from member_ids)
  union all
  select 'public.manual_test_wallets', 'CANDIDATE TEST WALLET STATE', count(*), 'Member manual-test wallets.'
  from public.manual_test_wallets where user_id in (select id from member_ids)
  union all
  select 'public.money_holds', 'PROTECTED FINANCIAL AUDIT', count(*), 'Hold/settlement evidence linked to member money transactions.'
  from public.money_holds where transaction_id in (select id from member_money_transactions)
  union all
  select 'public.money_events', 'PROTECTED FINANCIAL AUDIT', count(*), 'Event history linked to member money transactions.'
  from public.money_events where transaction_id in (select id from member_money_transactions)
  union all
  select 'public.money_adjustments', 'PROTECTED FINANCIAL AUDIT', count(*), 'Adjustment and reversal evidence linked to member transactions.'
  from public.money_adjustments where transaction_id in (select id from member_money_transactions)
  union all
  select 'public.money_alerts', 'PROTECTED FINANCIAL AUDIT', count(*), 'Financial alerts linked to member transactions.'
  from public.money_alerts where transaction_id in (select id from member_money_transactions)
  union all
  select 'public.money_business_ledger', 'PROTECTED BUSINESS ACCOUNTING', count(*), 'Business funding/budget audit linked to member activity.'
  from public.money_business_ledger where subject_id in (select id from member_money_transactions)
  union all
  select 'public.money_treasury_entries', 'PROTECTED BUSINESS ACCOUNTING', count(*), 'Treasury entries linked to member transactions.'
  from public.money_treasury_entries where transaction_id in (select id from member_money_transactions)
  union all
  select 'public.webhook_events', 'PROTECTED INTEGRATION AUDIT', count(*), 'Webhook events linked to member transactions.'
  from public.webhook_events
  where transaction_id in (select id from member_money_transactions)
     or transaction_id in (select id from member_payment_transactions)
  union all
  select 'public.withdrawal_payout_confirmations', 'PROTECTED PAYOUT AUDIT', count(*), 'Payout confirmations for member withdrawal requests.'
  from public.withdrawal_payout_confirmations where withdrawal_request_id in (select id from member_withdrawals)
  union all
  select 'public.sandbox_withdrawal_payouts', 'PROTECTED TEST PAYOUT AUDIT', count(*), 'Payout evidence for member sandbox withdrawals.'
  from public.sandbox_withdrawal_payouts where withdrawal_request_id in (select id from member_sandbox_withdrawals)
  union all
  select 'public.manual_test_ledger', 'PROTECTED TEST AUDIT', count(*), 'Manual test ledger rows for member requests.'
  from public.manual_test_ledger where request_id in (select id from member_manual_requests)
  union all
  select 'public.manual_test_audit', 'PROTECTED TEST AUDIT', count(*), 'Manual test review history for member requests.'
  from public.manual_test_audit where request_id in (select id from member_manual_requests)
  union all
  select 'public.money_audit', 'PROTECTED FINANCIAL AUDIT', count(*), 'Audit rows involving test members or their transactions.'
  from public.money_audit
  where actor_id in (select id from member_ids)
     or subject_id in (select id from member_ids)
     or subject_id in (select id from member_money_transactions)
)
select table_name, scope, row_count, notes
from report
order by case when table_name = 'PREFLIGHT' then 0 else 1 end, scope, table_name;
