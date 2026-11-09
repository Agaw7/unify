# AUREVIA admin enhancement — 7 November 2026

## Scope and existing-system audit

The existing Next.js App Router application and original Vercel project are retained.
`/admin` previously rendered legacy AdminHome (or redirected to manual sandbox).
It now renders the purple/gold member overview. Old components and records remain
available for rollback. No user, plan, transaction, balance, or cash account was deleted.

Authentication uses Supabase Auth bearer tokens. Admin API access checks the
server-owned profiles role, not a client role. Existing financial mutations retain
their MFA, independent reviewer, atomic PostgreSQL and ledger controls.

Actual schemas inspected in migration sources: profiles, team_members,
manual_test_wallets/requests/ledger/audit/settings, money_wallets/transactions/
investments/referral_commissions, sandbox_free_plan_grants. These names differ from
the illustrative names in the requirements. Test wallets are separate from live wallets.

## Changes

- Member search by phone or ID; overview and Invites/Deposits/Commission/Daily Reward tabs.
- Genuine test-wallet totals and test deposit/withdrawal reporting; historical financial
  records labeled separately. No example screenshot balances are seeded.
- Complete paged reads prevent silently truncated totals. A 100,000-record reporting
  limit fails explicitly rather than presenting an incomplete total.
- Last successful values stay visible on refresh failure. Request generations and
  selected-member IDs prevent stale responses being attributed to a different member.
- New read-only Payment Readiness page and append-only review evidence schema.
- Live collection, new withdrawal approval/submission, investment purchase/claims,
  scheduled tier credits, and cash reward claims are blocked by a compiled server
  approval lock. Environment variables cannot enable them. No client activation switch.
- Historical reconciliation, recording an already-sent manual payout, rejection/release,
  viewing balances, existing authentication, recipient management and test routes remain.
- Separate sandbox under-review and reversal transitions; row locking, unique references,
  atomic wallet/ledger/audit updates. A spent credit cannot reverse into a negative wallet.
- The receiver QR is hidden on the paused live deposit page so it cannot solicit funds.

## Migrations

43_payment_readiness_reviews.sql: new RLS-protected append-only evidence table;
service_role has SELECT only. No activation state or activation RPC. Evidence rows
do not independently activate payment execution.

44_sandbox_review_states.sql: requires migration 38 already installed; extends only
manual_test_requests statuses and review function, retaining paid references after
reversal. Updates sandbox admin reporting to include under-review and phone-only search.
Never run 38 twice: inspect its tables first. It creates an empty isolated test ledger,
not copies of live balances. Existing sandbox data must be preserved.

Promotional test credits are explicitly **Not configured**. Existing funded cash
promotions are not silently converted to test credits. No double-entry system is
claimed for the existing available/reserved delta ledger; it enforces reservation
consistency and test/live separation. A future general ledger remains a separate design.

## Files created

- src/components/AdminOverview.tsx
- src/components/admin-overview.module.css
- src/components/PaymentSettings.tsx
- src/components/PaymentPaused.tsx
- src/app/admin/payment-settings/page.tsx
- src/app/api/admin/member-overview/route.ts
- src/app/api/admin/payment-settings/route.ts
- src/lib/payment-readiness.ts
- database/43_payment_readiness_reviews.sql
- database/44_sandbox_review_states.sql
- tests/admin-enhancement.test.cjs
- docs/admin-readiness-enhancement.md
- docs/payment-approval-checklist.md

## Existing files modified

- src/app/admin/page.tsx
- src/app/deposit/page.tsx
- src/app/deposit/checkout/page.tsx
- src/components/ManualSandbox.tsx
- src/lib/money-server.ts
- src/lib/money-operations.ts
- src/app/api/money/route.ts
- src/app/api/investments/route.ts
- src/app/api/rewards/route.ts
- src/app/api/daily-tasks/route.ts
- src/app/api/admin/money/route.ts
- src/app/api/payments/deposit/manual/route.ts
- src/app/api/jobs/reconcile-payments/route.ts
- src/app/api/sandbox/manual/route.ts
- tests/money-promo-manual-mode.test.cjs

## Validation

Executed: nine targeted Node/PGlite tests covering unauthorized access, all-true
flag bypass rejection, test deposit approval/reversal idempotency, duplicate references,
reservations/completion/failure/release, insufficient funds, test/live isolation,
append-only review history and cash reward API lock. These are isolated test databases;
no production payment or reward was submitted by the agent.

TypeScript and production build passed. Initial sandboxed build hit Windows EPERM;
the same build succeeded with approved filesystem access. Existing legacy Dashboard
unused-import/img warnings remain. Fresh registration/login and a real payment have
not been end-to-end tested in this change.

## Deployment / environment

Use existing agaw7/unify Vercel project, not a new project. Keep gateway live flags
false. Sandbox and test-payment interfaces are retired. Historical sandbox schemas
and records are retained, but no environment flag re-enables their transaction
routes or the compiled live authorization lock.

Apply additive schemas to the intended database after inspecting existing objects;
do not reset Supabase or migrate balances. Build and deploy the existing linked project.
Verify admin member counts/search/tabs, 401/403 endpoints, mobile overflow, and the
readiness page. Reconcile existing obligations through retained historical workflows.

## Rollback

UI-only rollback: restore src/app/admin/page.tsx to render the retained
`@/components/legacy/AdminHome` component. Keep the approval lock and new schemas.
No records need deletion. Do not blindly git-reset this workspace: it contains
substantial preexisting uncommitted work.

Financial rollback: disable new execution, reconcile pending requests, and release
only valid reservations through existing audited operations. Do not drop ledgers or
reset balances. Reverting to an older deployment can restore previously enabled
manual execution; review its flags before promotion. Migration 44 can remain installed
with the old review UI: no need to remove under-review/reversed records or evidence history.

## Remaining independent launch requirements

See payment-approval-checklist.md. Neither this dashboard nor a merchant account
activation proves that the investment/referral model is authorized. Database privileged
owners can still alter functions; service credentials and migration access require
operational controls. No bank balance API, live transfer, regulatory verification or
independent merchant approval is claimed by this change.

## Release state

Applied in production Supabase yjuliuehlgzmpxoetefn on 7 November 2026:
prerequisite 38 (previously absent), 43 and 44. Verified all 30 existing money
transactions remain; test wallets/requests and evidence reviews are empty. Readiness
RLS is enabled. The service role can read evidence and audit history but cannot
insert evidence or directly insert test ledger rows. Supabase inherited default
privileges were explicitly revoked before granting SELECT only.

Deployed to the existing agaw7/unify production project:
https://unify-pmtksbrch-agaw7.vercel.app
Deployment: dpl_3h5bSzQmvumhMuZpYBFCy1xEPcij — Ready
Production alias: https://unify-woad.vercel.app

Verified via the signed-in live admin page: 5 active accounts (including admin),
2 recorded FreePlan members, 4 direct invites. Member detail/deposit tabs and
Payment Readiness loaded successfully. No financial mutation or user deletion
was performed. Live financial operations remain blocked. The separately isolated
sandbox endpoint remains disabled by production environment configuration; no
real QR or payment test was activated.

Mobile verification: 390px viewport, 375px document width, no horizontal overflow.
Search and alert contrast corrected against the legacy global theme. Local preview
artifact: admin-enhancement-mobile-preview.png. Deployed proof:
admin-enhancement-deployed.png; schema proof: admin-migrations-43-44-verified.png.
