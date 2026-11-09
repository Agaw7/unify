# Live Admin balance — 2026-10-24

> **Archived:** The live external-account balance check described in this
> historical implementation note has been removed. The current dashboard reads
> recorded ledger totals only and does not connect to a financial provider.

AdminHome now reads /api/admin/live-dashboard instead of sandbox /api/admin/stats. The eight metric cards retain their design, with live deposit/payment totals and an actual verified PayMongo merchant wallet available balance. Completed transactions alone count as paid; pending/approved/reserved/processing withdrawals remain pending. Today's deposits use immutable deposit-credit ledger dates in Asia/Manila. Test transaction tables are excluded. No records or balances were deleted or reset.

The new endpoint verifies the authenticated admin role before any provider request. The existing businessWalletBalance validator requires the configured exact wallet account number/name, live activated PHP wallet, and valid centavo amount. A failed provider check returns null plus a visible explanation, never a fabricated zero or test balance. Successful checks include a timestamp. Member balances, product receipts, and allocated rewards remain separate from provider cash.

Files: src/app/api/admin/live-dashboard/route.ts; src/components/legacy/AdminHome.tsx; tests/money-live-dashboard.test.cjs. TypeScript passed. Targeted live-dashboard and provider-wallet tests passed, including denied member access, live-only totals, date source, conversion, and provider-error behavior. No migration/environment changes or financial actions.

Isolated release backups/live-admin-balance-release-2026-10-24 over the prior live Daily Tasks deployment. Rollback: promote dpl_5FhPuDGiCunBQ8AFfiuiEyd9AFTZ through Vercel, preserving financial records.
Deployment dpl_8s3oHGm6PZBs61WS949F1dkvXrEa reached Ready and canonical production alias. Targeted ESLint passed; production build passed after correcting an unescaped apostrophe in UI text.
The active src/app/admin/page.tsx duplicated the legacy component; it now re-exports the updated AdminHome. The existing Business rewards budget navigation link was retained. Both component and page entry point are included in the release.
Final deployment dpl_FFidSe3wJoTiT6Y3jqRYoZPoYsaC Ready; canonical alias updated; production build passed (51 seconds). TypeScript and targeted ESLint passed for the final page/component.
