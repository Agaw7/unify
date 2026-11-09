# AUREVIA neon admin redesign

Reference: user-provided Aurevia Neon Admin Dashboard image, 7 November 2026.

## Implemented

- Responsive purple/gold sidebar and compact dashboard header/summary cards.
- Recent transactions with historical/sandbox source labels; no seeded example records.
- Manual payment-method status panels reflecting the existing execution pause.
- Sandbox deposit/withdrawal filter panels and links to the protected existing workflow.
- FreePlan member selector, recorded-plan table and network navigation.
- Balance/promotional management links using the existing protected screens.
- Phone/ID member search, five-row pagination, selected-member panel and record tabs.
- Actual recorded wallet, deposit, commission and tier-reward totals from the backend.
- Historical wallets and the separate sandbox ledger remain distinct.

No new grant-credit endpoint, bank transfer, payment activation, unrestricted balance
editor or financial mutation was introduced from the reference image. Its example
balances, growth percentages, names and payment approvals were not copied.
Recorded plans are not labeled active without expiry/eligibility evidence.

## Files

- src/components/AdminOverview.tsx — replacement presentation and existing navigation.
- src/components/admin-neon.module.css — isolated responsive neon styling.
- src/app/api/admin/member-overview/route.ts — additive read-only reporting fields.
- tests/admin-enhancement.test.cjs — test/live totals and transaction-source assertions.
- docs/neon-admin-redesign.md — implementation and rollback notes.

The older admin-overview.module.css remains for Payment Readiness, preserving that page.
No SQL migration or environment change is required for this UI update.

## Validation

TypeScript and targeted ESLint passed. Nine targeted API/PostgreSQL tests passed,
including the approval lock and separation between recorded wallets and test funds.
Build and browser verification are recorded with the release below once completed.

## Rollback

The previous production deployment is dpl_3h5bSzQmvumhMuZpYBFCy1xEPcij
(unify-pmtksbrch-agaw7.vercel.app), which includes the same payment approval lock.
Promote that deployment to restore the previous admin presentation without changing
database records. The additive API fields in this release do not break the old client.
Keep migrations 38/43/44 installed; no financial records need rollback or deletion.

## Release verification

Deployed to the existing agaw7/unify project:
https://unify-b2mnsuhgv-agaw7.vercel.app
Deployment dpl_8ARMsiSLRz94a8R8BwhWG5h4bFVx is Ready and aliased to
https://unify-woad.vercel.app. No database or environment change was applied.

Production build passed, with only the existing legacy Dashboard warnings.
Verified using the signed-in production session: summary values load, local-format
phone search finds the correct international-format account, View selects that
member, and deposit-history tabs show existing records. Desktop 1680px and mobile
390px layouts were inspected. At mobile, document width is 375px with no horizontal
page overflow. The Menu button opens a readable two-column navigation menu.

The existing production execution lock and approval restrictions remain unchanged.
No financial action was submitted. Proof images: aurevia-neon-admin-deployed.png
and aurevia-neon-admin-mobile.png.
