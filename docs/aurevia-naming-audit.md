# AUREVIA naming refactor review

Production was inspected read-only on Supabase project `yjuliuehlgzmpxoetefn`, PostgreSQL 17.11. Both local environment files resolve to that same project, including the one named staging. A separate staging target and a verified restore have yet to be established. The catalog evidence is in [the production inventory](aurevia-naming-production-catalog.md).

## Proposed mapping

| Existing source | Proposed application read name | Reason |
|---|---|---|
| `sandbox_free_plan_grants` | `free_plan_grants` | Practice grant rows carry `record_origin = sandbox`. Funded FreePlans come from `money_investments`. |
| `demo_investments` | `investment_records` | Preserve the original investment IDs and acquisition type. These rows carry practice provenance. |
| `sandbox_wallets.remaining_balance` | `practice_wallet_accounts.recorded_balance` | `wallet_accounts` already exists. The proposed source column `simulated_balance` was absent. Preserve the numeric PHP unit. |
| `unify_sandbox_wallets` | `practice_transfer_wallets` | Separate ledger with a centavo balance and its own transfer routine. |
| `unify_sandbox_transactions` | `practice_transaction_records` | `test_transactions` was absent. This actual source contains practice transfers. Keep funded and legacy payment records separate. |

The forward preview adds five security-invoker read views. It preserves existing object IDs, stored routine names, policies, grants on base tables, and all financial rows. PostgreSQL still checks the caller's underlying table permissions and RLS. The views explicitly expose practice provenance and grant SELECT only. The production UI should use “Available Balance” and “Withdrawal Balance” for the corresponding funded-wallet fields and label visible legacy activity “Practice” with its cash eligibility clearly stated. For historical mixed payment sources, keep source and verification state visible and derive real-payment wording from independently verified evidence.

## Dependencies and rollout

- `demo_investments` is referenced by `sandbox_free_plan_grants.investment_id` and `simulation_daily_credits.investment_id`. Its outgoing FKs reference users and products. Its SQL callers are `claim_simulation_days`, `get_daily_team_tasks`, `grant_sandbox_free_plan`, and `purchase_demo_investment`.
- `sandbox_free_plan_grants` is read by the admin FreePlan and member overview API routes and written by `grant_sandbox_free_plan`. Keep the existing per-user and per-investment uniqueness, grantor/request idempotency, note limit, and owner-read policy.
- `sandbox_wallets` is read by legacy Dashboard and Withdraw. Its routines cover practice purchases, claims, registration bonuses, referral credits and withdrawal reservation/rejection. The Dashboard has two balance reads that must both switch projection names.
- Legacy Wallet reads the separate `unify_sandbox_wallets` and `unify_sandbox_transactions` pair. `unify_sandbox_transfer` writes to both. The centavo fields retain their units.
- The catalog found the practice referral trigger on `payment_transactions` and bonus triggers on `auth.users` and `profiles`. Renaming source identifiers in a function body requires explicit replacement and retesting. A table rename also does not rename its index or constraint names automatically.
- Manual practice wallets, requests, ledger, settings and audit tables use a separate API, service RPCs, and the private `aurevia-test-qr` bucket. Preserve `transaction_mode = 'sandbox'`, simulated payout states, and all audit values. The catalog returned no table publication memberships or public views. The repository search found no Supabase channel subscriptions, and the production Edge Functions page showed no deployed functions.
- Receipt code refers to `manual-deposit-receipts` and `withdrawal-payout-proofs`. Only `aurevia-test-qr` appeared in the inspected production bucket list. Confirm which deployed workflows use legacy receipt storage and validate both receipt paths on the restore before approving any storage changes. Bucket IDs and object paths are outside the SQL preview.
- Historical migration files, cleanup scripts and test fixtures contain the old names. Keep applied migration files intact. Do not run the historical cleanup scripts as part of naming work. Audit environment flags, PayMongo mode checks, callback URLs and compatibility routes separately from display text.

Rollout order after approval:

1. Verify an isolated backup restore, including auth, RLS, routines, constraints, ledger totals and private receipt availability. Confirm the exact environment target and preflight name availability.
2. Apply the forward preview in staging. Verify aliases under authenticated and service roles, including cross-member access denial. Compare IDs, amounts, classification and relationship behavior.
3. Switch the audited application reads and types to the aliases. Update production-facing copy, keep original RPC write paths during transition, and scan all API routes for obsolete direct table references. Run TypeScript, build, authentication, permission, ledger, deposit, receipt, payout, FreePlan, and Free Balance checks with nonfinancial staging fixtures.
4. Review physical renames, RPC names, index and policy labels, bucket IDs and any remaining compatibility endpoints as a separate cutover. Any removal requires verified dependency discovery and its own exact forward and rollback SQL. A physical rename now risks breaking deployed clients, PostgREST callers, write functions and scripts that still address the base table names.

## Rollback

Restore the prior application release first if callers have switched. Confirm active traffic no longer depends on the aliases, then run the rollback preview with RESTRICT. It drops only the five views and refreshes the schema cache. Compare original permissions, row IDs, balances and ledger totals against the backup manifest. There is no data reversal for the alias migration.

Local `productionPaymentsAuthorized` is currently set to true. A naming-only rollout needs a release based on the approved production payment behavior, with that setting reviewed separately before publishing.
