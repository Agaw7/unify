# Production upgrade: audit and implementation record

Date: 2026-10-24. Status: incremental local hardening; NOT production launch approval.

## Plan

1. Preserve the dirty working tree with a source snapshot and SHA-256 manifest.
2. Inventory pages, components, handlers, financial workflows and simulation terminology.
3. Review authentication, provider boundaries, financial SQL and deployment configuration.
4. Correct verified defects without redesigning the existing interface.
5. Execute isolated financial tests, TypeScript validation and production build.
6. Independently verify deployed schema permissions, provider configuration and acceptance tests before live activation.

The user subsequently requested all live flags true. This is authorization to prepare activation, but does not establish provider or database readiness. This change set does not change deployed flags or make transfers.

## Existing behavior and dependencies

The dashboard and team use the preserved legacy dashboard. Registration uses Supabase phone/password authentication and referral attribution. Login restores a persistent browser Supabase session; API handlers independently verify bearer tokens. Admin financial operations additionally require role and MFA checks. Existing six-character password policy and referral codes are preserved.

Sandbox deposits use test PayMongo checkout confirmation and atomic database credit. Sandbox remaining balance, deposit balance and the standalone sandbox wallet are separate stores; they must never be summed into real funds. Purchases, daily claims, free plans and referral commissions remain simulation features in the restored interface. Withdrawal modes snapshot new requests, reserve funds atomically and support repeat-safe rejection and simulated completion.

The separate money layer uses integer centavos, provider-confirmed deposits, settlement holds, identity/recipient checks, payout claims, reconciliation and refund/dispute handling. Existing in-flight payments must remain reconcilable when new-payment flags are off. Migration 18 contains separate funded live contracts; old simulation records must not be converted into live liabilities.

See upgrade-inventory.md for the generated page, handler, component and terminology inventory. Matching text is an inventory, not a completed editorial classification: simulation labels remain unchanged. API aliases and archived components require additional runtime review before removal.

## Findings and incremental fixes

- Provider POST calls previously depended on caller-level flags. Added checks at the final provider boundary for checkout, payout and refund operations; unsupported writes fail closed. Read-only reconciliation remains available.
- Standalone /wallet sent both actions to a configuration-only deposit diagnostic. It now uses the matching sandbox transfer endpoints and explicitly labels completion as simulated.
- Sandbox transfer authentication accepted only the publishable-key environment alias. It now also accepts the established anon-key alias.
- Multiple historical payment routes and wallet ledgers exist. This upgrade does not merge or delete them.
- Local baseline schema files differ from the evolved UUID product schema. Never replay schema.sql or setup.sql against production as an upgrade.
- Existing money ledger records account deltas; a full balanced double-entry accounting model has not been verified. Do not represent it as independently audited double-entry accounting.
- Previous provider readiness checks reported a payout source-name mismatch. It needs fresh provider validation before payouts are enabled.
- Deployed RLS, function ACLs, triggers and backup recovery have not been independently re-audited in this increment. Isolated SQL tests do not prove production configuration.

## Files changed in this increment

- .gitignore: exclude source snapshots.
- .vercelignore: prevent snapshot upload.
- src/lib/money-server.ts: provider write guards.
- src/lib/sandbox-api.ts: supported public-key fallback.
- src/app/wallet/page.tsx: correct sandbox endpoints and honest success labels.
- tests/money-provider-flags.test.cjs: disabled operations cannot reach fetch.
- docs/upgrade-inventory.md: generated repository and terminology inventory.
- docs/production-upgrade-audit.md: plan, findings and operational procedures.
- database/audit_production_readonly.sql: read-only deployed catalog audit queries; not executed against production in this increment.

Existing uncommitted files predate this increment and are preserved. Build-generated files may also change.

## Database migrations and data safety

No migration was created or applied in this increment. No account, balance or transaction was deleted or changed by this work. Existing migrations 03–18 describe successive financial features, not a safe baseline reset. Before further schema changes export current definitions, privileges and policies, reconcile applied migration versions, take a provider database backup and test restoration in a separate project. A source snapshot is not a database backup.

The new audit SQL contains only catalog SELECT statements inside a read-only transaction, followed by rollback. Its results still require review; a SECURITY DEFINER function being executable by members can be intentional, but its body must enforce ownership and safe search_path.

## Environment and deployment

Server-only variables: SUPABASE_SERVICE_ROLE_KEY, PAYMONGO_SECRET_KEY, PAYMONGO_WEBHOOK_SECRET, PAYMONGO_LIVE_SECRET_KEY, PAYMONGO_LIVE_WEBHOOK_SECRET, CRON_SECRET, PAYMONGO_WALLET_ACCOUNT_NUMBER and PAYMONGO_WALLET_ACCOUNT_NAME. Never use NEXT_PUBLIC names for secrets. Public Supabase URL/anon key are intended for browser use with RLS.

LIVE_PAYMENTS_ENABLED, LIVE_PAYOUTS_ENABLED and LIVE_REFUNDS_ENABLED default false in .env.example. PAYMONGO_PAYOUT_ENABLE is a separate payout switch. VERIFICATION_REVIEW_ENABLED controls review availability; sandbox claim/payout switches remain independent. Enabling flags does not grant wallet funding, identity approval, settlement or business authorization.

Before production deployment: complete deployed-schema permission audit and provider source-account verification; confirm approved business scope; verify backup restoration; run registration/login/navigation and sandbox checkout acceptance in staging; verify mobile layouts; test webhook replay and true multi-session PostgreSQL concurrency. Preview this code first, then deploy the exact tested source with the intended environment. Never include backups or .env files in uploaded source.

## Rollback

Source snapshot: backups/2026-10-23T17-34-32-332Z/manifest.json. This snapshot includes pre-existing uncommitted source and excludes credentials, dependencies, build outputs and database data. Restore only affected source files from this snapshot after reviewing any subsequent edits; do not reset the whole repository.

Previous known deployed version: dpl_2j9VJG15W2jv1e8JBw7s5JGVoSPE, https://unify-dcmso1idy-agaw7.vercel.app. Verify its current availability in Vercel before promoting it. Set new-payment/payout/refund flags false and redeploy to stop new operations while retaining reconciliation of already-submitted transactions. Do not reverse financial rows or replay migrations as an application rollback. Review provider outcomes and immutable ledger records before any balance correction.

## Acceptance coverage limits

Executed in this increment: initial TypeScript validation passed; node --test tests/*.test.cjs passed 72/72 tests (including the new provider-boundary guard). Local check:money-launch exited 1: live key, webhook secret, cron secret and source wallet were missing in the selected local environment; all three local live flags were disabled. This says nothing about Vercel secrets. Production build and the later combined TypeScript/lint attempt stalled and were interrupted without a result; they must not be reported as passed. The final wallet route edit occurred after the initial test run and needs final verification.

Tests use isolated PGlite databases and mocked provider/auth boundaries. They do not constitute production login, actual QRPh payment, external payout, browser mobile-layout verification or multi-connection PostgreSQL stress testing. Those checks remain required; never claim them passed from unit tests alone.
