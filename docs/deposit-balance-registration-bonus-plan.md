# Deposit purchase balance and funded registration bonus

Requested behavior: show a separate Deposit Balance spendable on products only; never use it to satisfy withdrawal requests. Show a genuine PHP 30 registration bonus in available PHP funds after a funded ledger credit. Do not import the existing sandbox PHP 30 or PHP 200 into live balances.

## Required accounting changes

1. Add a separately recorded purchase-only balance and immutable ledger deltas, default zero. Do not reclassify existing wallet amounts without reconciling their origin.
2. Verified QRPh payments remain held until documented settlement. Settlement credits purchase-only funds, not withdrawable available funds.
3. Product purchases debit the purchase-only bucket atomically. Withdrawals reserve only withdrawable available funds. Retain recipient verification, idempotency, row locking and rejection reversals.
4. Refunds and disputes must reserve and restore the original bucket correctly. Reconciliation and business-funding liability totals must include purchase-only funds; otherwise member cash could be incorrectly allocated as business rewards.
5. Add a one-time registration-bonus grant with a unique user constraint, PHP 3,000-centavo amount, internal transaction, user ledger credit, business-budget debit and audit record in one database transaction. No direct frontend balance changes. Insufficient business funding must defer the grant rather than fabricate a balance.
6. Update the authenticated wallet API and dashboard to show both buckets, with a concise purchase-only/non-withdrawable label on deposits. Do not relabel simulated balances.
7. Test deposit settlement, purchase debits, withdrawal exclusion, bonus replay/concurrency, insufficient funding, permissions, refund/dispute restoration and total liability conservation before applying the migration.

## Funding classification confirmed

The owner explicitly confirmed PHP 200 as business funding for registration bonuses, daily rewards and referral commissions. The PayMongo dashboard showed a successful PHP 200 inward transfer, and the MFA-protected server source-wallet check verified PHP 200 available with a matching source account name. It is not a personal product deposit. The final business allocation and bonus claim remain user-submitted financial actions.

## Existing product funding constraint

Live plan purchases currently reserve the entire future reward obligation from the business budget (daily amount × 365). For example, a PHP 50 daily plan requires PHP 18,250 in rewards reserves. A PHP 200 wallet top-up cannot fund that obligation. This requirement must remain enforced; adding a purchase-only balance does not establish the ability to fund live plans.

Migration 19 was approved and applied successfully on 2026-10-24. Before applying, the live wallet, live transaction and funding tables were empty and the business budget was zero; the migration also refuses first application if an unreconciled live ledger exists. Existing sandbox records were preserved. The production schema verification confirmed the new deposit_available column and bonus table without balance mutation.

## Implementation and validation

- Migration: database/19_purchase_wallet_registration_bonus.sql. Generator: scripts/build-purchase-wallet-migration.cjs. Both are local review artifacts, excluded from deployment.
- Settlement credits purchase-only deposits. Purchases use deposits first, then available funds. Withdrawal reservation continues to use only available funds. Refund/dispute reservations and reversals preserve each bucket, including repayment of prior dispute debt. Business allocation liability checks include deposit funds.
- PHP 30 bonus is an explicit user action, backed by a business-budget debit, immutable user/business ledger entries and a unique user grant. Page loads are read-only. The authenticated endpoint ignores supplied user IDs and can only grant to its signed-in caller.
- Existing migration 18 daily rewards reserve business budget up front; commissions debit funded business budget. Product receipts remain excluded from reusable business funding. No live-product purchase page was added.
- 74 automated tests passed, TypeScript passed, targeted ESLint passed with no warnings/errors. Added tests cover deposit non-withdrawability, purchase debit, bonus repeat/concurrent requests, zero-funding rollback, source-of-funds conservation, refund/dispute restoration, debt-repayment reversal, migration reapplication, permissions, forged user IDs and disabled live configuration. PGlite tests do not substitute for independent multi-session production stress tests.
- Isolated production release: dpl_2jLCYsFQGP4mvGqf3GJ7uT5Qpua3, https://unify-7q044m4d2-agaw7.vercel.app; Ready and aliased to unify-woad.vercel.app. Only the nine related application files listed in purchase-wallet-release-files.json were overlaid on the prior deployed release. Unfinished audit edits remain excluded.
- Browser verification: dashboard shows PHP Wallet available PHP 0.00, Deposit Balance PHP 0.00, explicit bonus claim button and non-withdrawable deposit note. Admin funding screen verifies source PHP 200.00, proposed allocation PHP 200, funding reference, and unchanged unallocated budget PHP 0 until submission.

## Rejections and user handoff

Automatic approval rejected implicit dashboard-load bonus credits. Replaced that behavior with an explicit claim action. It also rejected adding a live purchase page and exposing an admin funding screen without separate approval. The live purchase page was excluded; the user subsequently explicitly approved migration 19 and the admin funding screen only.

The owner must submit the business-allocation confirmation and bonus claim themselves. If both succeed with no other activity, member available funds become PHP 30.00, Deposit Balance remains PHP 0.00, and unallocated business budget becomes PHP 170.00. These are expected postconditions, not claimed completed credits.

## Rollback

Do not drop the new column/table or delete bonus, allocation or purchase history after use. Preserve bucket-aware settlement, adjustment and funding functions while existing purchase-only liabilities exist. If the UI needs rollback, use a compatible UI that still distinguishes the two buckets; simply reverting to old available-only accounting is unsafe. Disable new claims/purchases operationally and reconcile immutable ledger totals before any financial correction. No production balances should be manually overwritten.
