# Automatic registration bonus and manual reclaim — 2026-10-24

## Approved behavior

The owner requested no Claim button: new Supabase registrations receive a funded PHP 30 bonus automatically. If the business rewards allocation is insufficient or the account is restricted, registration succeeds and the bonus remains pending rather than inventing funds. Funding increases process eligible queued bonuses in bounded batches of up to 500. This is a database signup/funding workflow; dashboard reads do not mutate money.

Only existing admin 09157471830 was explicitly approved for enrollment. The one-time enrollment script verifies its UUID, phone and admin role and adds a pending queue row. Other existing users are excluded. New users are queued by an auth.users AFTER INSERT trigger.

The owner selected manual admin reclaim only if BOTH conditions hold: no completed deposit AND no approved identity verification on record. The full PHP 30 must also be provably unspent: available funds cover it, no outstanding reserve/debt, and no negative available-ledger movement since the original funded grant. Any uncertain spending history blocks reclaim, even if later earnings replenished the balance. Prior identity approval remains protective via audit history even after its status expires.

An admin reclaim requires MFA and a reason, atomically debits only the eligible registration bonus, returns it to business budget, and appends user/business ledger and audit records. It is idempotent and never reissues the reclaimed bonus to the same account. No provider transfer is made. Deposits and other earnings are protected.

## Production implementation

- database/20_automatic_registration_bonus.sql: protected queue, signup trigger, funded-budget trigger, repeat-safe pending worker. Does not enroll old accounts.
- scripts/enroll-owner-registration-bonus.sql: explicit owner-only pending enrollment, no financial credit.
- database/21_registration_bonus_reclaim.sql: reclaim fields, historical identity/deposit/unspent checks, admin overview and atomic reversal function.
- Application files: see automatic-bonus-release-files.json (seven files). Adds admin reclaim API/component, automatic status instead of Claim button, registration disclosure, and funding navigation/anchor. An existing manual-grant API remains for backward compatibility; its database grant remains one-time and cannot reinstate a reclaimed bonus.

Exact migrations 20/21 and the owner enrollment were explicitly approved after automatic review rejected the Supabase potentially-destructive confirmation. Supabase then reported Success for the combined transaction. Pre/post checks showed one pending owner queue entry, zero grants, and zero business allocation; no other old account was queued or credited.

Release: dpl_Fh8NSpwbUPsvR38asGf9WwFrmbXt, https://unify-fsjtdxwt5-agaw7.vercel.app. Vercel Ready after 39-second build; canonical aliases unify-woad.vercel.app and unify-agaw7.vercel.app. An isolated source copy of the previous release with seven related files overlaid excludes unfinished audit edits. Live flags and provider credentials were not modified.

## Validation

77 automated tests passed; TypeScript passed; targeted ESLint passed. New tests exercise actual signup and funding triggers in isolated PGlite, zero-budget signup, automatic/replayed grants, scope of existing-account enrollment, role restrictions, reclaim retries, deposit and historical identity protection, conservation of cash, and protection of later commission earnings after spending. The admin endpoint tests verify MFA/admin boundary usage, trusted actor derivation, input validation and database eligibility decisions.

Browser verification: dashboard has no Claim button and shows pending automatic registration bonus; purchase-only Deposit Balance remains separate. Funding screen displays a server-verified PHP 200 source, proposed PHP 200 allocation, actual successful funding reference and enabled Verify & allocate budget button. Reclaim section loads with no funded grants yet. The registration-page disclosure was added without changing signup credentials, password policy or referral flow.

No production test accounts were created, no payout or reclaim was submitted, and no bonus was fabricated. PGlite tests are not a multi-session production concurrency stress test or an actual production signup acceptance test.

## Owner handoff

The owner must submit the prepared business allocation and confirm it. The business budget remained PHP 0 at final preparation, although PayMongo source balance was verified as PHP 200. Once allocation succeeds, the pending owner bonus is processed automatically: expected member available PHP 30, purchase-only Deposit Balance PHP 0, business budget PHP 170, assuming no other registrations or allocations intervene. These are expected outcomes, not completed financial credits.

Screenshots: automatic-bonus-dashboard.png and automatic-bonus-funding-ready.png.

## Completed owner allocation verification

After the owner submitted the allocation and reported done, read-only production checks confirmed PHP 200 cumulative business funding, PHP 170 available business budget, PHP 30 owner available wallet funds, and PHP 0 purchase-only deposits. Queue status is granted, the grant is not revoked, and the owner's immutable ledger contains exactly one PHP 30 registration-bonus credit (transaction 485d14fb-b0fc-4ad3-95e5-d786111c45eb). There were no reserves, holds or debts. The PHP 170 budget plus PHP 30 member liability equals the PHP 200 allocation. No additional financial mutation was performed during verification.

## Rollback

Do not delete grants, queue, reversal or ledger history. To pause issuance, a privileged, separately reviewed database operation can disable only the named signup/funding bonus triggers while keeping the pending queue and ledger. UI rollback alone does not disable database triggers. Preserve the reversal transaction kind and bucket-aware functions after use; never reset balances to roll back. Reconcile grants/reversals and provider cash before any financial correction. Prior application release: dpl_2jLCYsFQGP4mvGqf3GJ7uT5Qpua3.
