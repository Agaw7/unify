# Manual PalawanPay / GoTyme deployment

Existing production project: agaw7/unify. No new project or wallet database.

## Current application status

The application no longer contains automated payment-provider integration:
hosted checkout, live balance lookup, provider reconciliation, payouts, and
webhook processing are unavailable. `/deposit` is paused. The production
financial-operations lock also blocks manual transaction approvals and requests.
Existing accounts, ledger entries, migrations, and historical external references
remain intact; no database reset or migration was performed. Remove any remaining
provider credentials from Vercel project settings separately, after checking for
unsettled external transactions. The implementation notes below are historical
and do not describe currently available payment actions.

## Retired sandbox and test-payment flows

Sandbox deposit, withdrawal, reward-claim, wallet, admin review, PayMongo test
checkout, webhook, and reconciliation interfaces are disabled. Their database
tables, migrations, and historical records are retained and are not merged
with live wallet balances. Do not apply sandbox migrations to re-enable these
flows. Live collections and disbursements remain paused until independently
verified authorization and provider eligibility are established.

## Database

The existing database and historical sandbox migrations are preserved. Do not
reset accounts, delete historical transactions, or merge test balances into live
wallets.

## Configuration

Production payment execution remains paused. Do not enable live collection,
withdrawal, or payout flags until authorization and provider eligibility are
independently verified.

Manual payment records are separate from gateway integrations. Historical external references remain in the database; the old automated reconciliation code and local provider credentials have been removed. Confirm any unresolved external transaction directly from official account statements before making external credential changes.

## Operations

Deposit: /deposit displays the supplied, unchanged PalawanPay QR and download. Member submits amount, reference and receipt. Admin reviews in /admin/money (also reached from /admin/deposits), independently checks the actual receiving account amount/reference, then approves or rejects. A receipt alone is not proof. Approval credits purchase-only Deposit Balance once. Rejection adds no funds.

Withdrawal: /withdraw opens /money. Member adds a GoTyme account for identity/ownership review. Verified members request a withdrawal from available funds, reserving the gross amount. Minimum is PHP60; existing 5% fee applies. Admin approves; a different payout administrator claims processing. Transfer happens outside AUREVIA, manually. Record the confirmed transfer reference/result. Unknown results remain processing. Confirmed failure returns the reservation once. Existing administrator MFA and independent-review checks remain in force, including no self-approval.

No bank transfer was performed or independently verified during deployment. Production end-to-end financial approval and transfer testing requires the administrators to perform those actions.

## Validation

PGlite tests: manual Palawan approval/rejection, duplicate/reference prevention; GoTyme reservation, unique transfer reference, completion/failure retry and access controls. TypeScript and changed-file ESLint pass. Build passes with existing legacy Dashboard lint warnings.

## Rollback

Disable the two new manual flags to stop new requests; keep pending reservations and transaction records. Redeploy the prior known-good deployment only after confirming its database/environment target and disabling new gateway writes. Do not drop the additive functions or constraints while manual transactions are pending. Reconcile each pending or processing transaction against the external account before resolving it. Never bulk reset wallet balances.

## Withdrawal UI and additional recipients

Migration 41_manual_wallet_withdrawals.sql extends manual result recording to GCash and Maya while preserving the GoTyme function signature, administrator authorization, reservations and idempotency. It does not change balances or send funds. /withdraw now redirects to /withdrawal, with /bank-account for account binding. The minimum remains PHP60 and fee remains 5%. All three methods use external manual transfers and existing identity/ownership reviews. New screens use an isolated dark/gold design without changing Home or Profile. Roll back application routes independently; do not reset pending reservations or drop financial records.


Files for withdrawal UI update: src/components/ManualWithdrawal.tsx; src/components/manual-withdrawal.module.css; src/app/withdrawal/page.tsx; src/app/bank-account/page.tsx; src/app/withdraw/layout.tsx; src/components/LiveDashboard.tsx; src/components/MoneyWalletPage.tsx; src/components/MemberVerification.tsx; src/app/api/money/route.ts; src/app/api/admin/money/route.ts; src/app/admin/money/page.tsx; src/lib/money-operations.ts; database/41_manual_wallet_withdrawals.sql; tests/money-manual-gotyme.test.cjs.

Validation: four database tests passed (PalawanPay, GoTyme, GCash, Maya); changed-file lint passed; TypeScript passed; local production build succeeded after rerunning with workspace write permissions. Existing legacy Dashboard lint warnings remain. No production financial transaction was created during tests.


## GCash / Maya only

GoTyme was subsequently removed from all active live recipient choices. New recipient and withdrawal API requests accept GCash and Maya only, with exactly 11 digits starting 09. Existing GoTyme records and their audit/reconciliation functions are retained for historical transaction handling; no financial data is deleted. No further database migration is needed for this application-level restriction.


## Unified AUREVIA payment accounts

Profile BankAccounts now renders the same bank-only ManualWithdrawal component as /bank-account. Both save new accounts to the authenticated money_destinations API. The API also returns the current user's older payment_accounts entries read-only; unmatched entries are shown as previously saved and require the member to confirm linking them for withdrawal review. Legacy entries are not silently promoted to verified recipients. Repeated sequential saves of identical recipient details return the existing destination; a conflicting name requires support. Existing records are preserved. No SQL migration or balance change is involved. Withdrawal/account screens use the shared AUREVIA lavender/plum colors and accurate GCash/Maya mobile-number labels.


## Reward panels and Friends cleanup

Historical note: Gift Code and one-click Daily Check-in were previously enabled in manual PalawanPay mode. They remain subject to the production financial-operations lock and are not currently available. Their historical ledger entries and budget accounting are preserved.


## Admin business-balance card

The admin top card reads recorded business-budget totals through the admin-authorized live-dashboard endpoint. External account balances are not queried, and member deposits are not reclassified as business funding. Budget reports are read-only; new automated funding verification and allocations are unavailable.
