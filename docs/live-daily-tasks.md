# Live Daily Tasks — 2026-10-24

Existing task design/milestones retained: 5/10/20/30/50 direct active invites yield PHP50/100/250/400/1500 respectively. A direct member counts once each Philippine calendar day after purchasing a live product that day. Repeated purchases by one member count once; free grants, simulated investments, purchases before the Philippine day boundary, and indirect invites do not count. Each unlocked milestone is individually claimable once per user/day.

Migration 23 adds a separate RLS-protected live claim table and service-only read/claim functions. Claims atomically debit available business rewards budget and credit PHP Wallet Available Balance with transaction, member ledger, business ledger, and audit entries. Budget/user locking plus unique user/date/milestone constraints prevent duplicate credit. Insufficient funding rolls back; historical sandbox records and existing balances are untouched. No actual claim was submitted by the agent.

API /api/daily-tasks authenticates the user; POST additionally enforces live configuration and server-controlled milestones. The frontend now reads live task state and shows Awaiting funding when an eligible reward cannot be funded. Rewards remain subject to the existing withdrawal checks.

Files: database/23_live_daily_tasks.sql; src/app/api/daily-tasks/route.ts; src/components/legacy/Dashboard.tsx; tests/money-live-daily-tasks.test.cjs; this report. TypeScript passed. PGlite migration applied twice successfully; tests cover distinct direct counting, exclusions, locked milestone, insufficient funding rollback, repeated claims, wallet/budget conservation, per-user state, invalid milestone, and denied browser-role access.

Migration 23 successfully applied to production (SQL editor Success). Isolated release: backups/live-daily-tasks-release-2026-10-24. No environment changes. Rollback UI/API by promoting prior deployment dpl_CgjKzb2kPQYroqjqpJWfz2CFP2Mx. Leave additive functions/table and any real claim records intact; do not reset balances or re-run older transaction-kind constraints over new daily-task entries.
Production deployment dpl_5FhPuDGiCunBQ8AFfiuiEyd9AFTZ Ready and aliased to https://unify-woad.vercel.app; production build passed.
