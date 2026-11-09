# Separate admin payment pages

Manage Deposits and Manage Withdrawals now have separate Admin buttons and routes. The previous /admin/transactions route remains available with its combined history. Existing API calls, authorization, records and actions are unchanged. No database migration or environment change.

Files modified:
- src/components/legacy/AdminHome.tsx
- src/components/AdminTransactions.tsx (shared client component extracted from the original page)
- src/app/admin/transactions/page.tsx (compatibility wrapper)
- src/app/admin/deposits/page.tsx
- src/app/admin/withdrawals/page.tsx

Release: backups/separate-admin-payments-release-2026-11-05, based on deployed admin-contrast release. Rollback: promote dpl_CTjSEWBvooWLvB9r7mTb8ivB8mPU. No financial data rollback is needed.

Validation: local build encountered filesystem EPERM. First remote build caught an invalid Next.js page export; corrected to a no-props route wrapper. Final remote validation recorded below.

Final Vercel build passed compilation, lint/type validation and page generation. Deployment dpl_4LWbxLgxyBf6dAXs1f497GycvARo is Ready and aliased to https://unify-woad.vercel.app. Existing Dashboard warnings remain.

Browser verified separate Admin links, Deposits-only section on /admin/deposits and Withdrawals-only section on /admin/withdrawals. No transaction actions were submitted.
