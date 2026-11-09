# Live Team commissions — 2026-10-24

Dashboard Team now reads authenticated /api/team → service-only money_live_team rather than my_sandbox_team and sandbox_wallets. Live centavo amounts are converted to pesos once for display. Member deposit totals, per-member earned commissions, level totals, and overall total use live records. Labels explain settlement and business-budget requirements. Historical test commissions are preserved separately and never converted into real wallet funds.

Existing money_referrals_process already enforces unique(deposit_id,level), unique(deposit_id,beneficiary_id), budget row locking, pending-only payout, and unique commission transaction references. Each settled deposit can pay each eligible upline once (L1 30%, L2 2%, L3 1%). A separate deposit can earn again. Paid commissions credit PHP Wallet Available Balance. Unsettled deposits are not eligible; insufficient business funding leaves commissions pending. No migration or balance modification was necessary.

Changed application file: src/components/legacy/Dashboard.tsx. Tests: tests/money-funded-plans.test.cjs extended with repeated processing of two separate deposits; tests/money-live-team-api.test.cjs verifies authenticated user scoping. TypeScript and targeted funded-plan/live-summary tests passed. No real commission processing was invoked as part of verification.

Deployment uses isolated backups/live-team-release-2026-10-24 over the prior deployed release. Rollback: promote dpl_GStGesCXaX6SBcwAmcWtu8a6TUD1 in Vercel; preserve all ledger records.

Deployment dpl_5CgTTqCMAcCSi4hZDpAYycp6xr9v reached Ready on the canonical production domain. Funded-plan repeated-deposit and authenticated Team API tests both passed; production build passed.
