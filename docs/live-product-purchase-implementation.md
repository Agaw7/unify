# Live product checkout — 2026-10-24

Production deployment: dpl_F2YC9pjMyHeHxsgsEYAVrLxzxRHe (Ready), https://unify-woad.vercel.app.

## Behavior

Dashboard Start Investment opens the selected live product checkout. Products routes to live investments; Assets routes to the live portfolio. Purchases consume purchase-only Deposit Balance first, then available PHP funds. Each new contract requires its entire 365-day reward liability to be reserved from the separate business rewards budget. Existing simulation records and claims remain available through explicitly labeled archive pages; they are not converted to cash.

Checkout displays accepted price, daily reward, duration, funding availability, wallet funds, and terms. The server verifies the accepted quote under database locks. Persistent purchase idempotency keys and receipt recovery prevent retries from creating duplicate contracts after uncertain responses. Real purchase and claim operations retain server-side feature checks.

## Modified application files

- src/components/legacy/Dashboard.tsx
- src/components/LiveInvestments.tsx
- src/components/RealWalletSummary.tsx
- src/app/api/investments/route.ts
- src/app/investments/page.tsx
- src/app/products/page.tsx
- src/app/simulation-portfolio/page.tsx
- src/app/simulation-products/page.tsx

Additional files: database/22_quoted_live_product_purchase.sql; tests/money-quoted-product-purchase.test.cjs; tests/money-live-products-api.test.cjs; docs/live-product-release-files.json; this report; live-product-checkout.png.

## Migration

Migration 22 was applied successfully to production. It adds a service-role-only quoted purchase wrapper, locks budget/user/product state, verifies accepted terms, and delegates to the existing atomic ledger operation. It creates no contracts and changes no balances. PUBLIC, anon, and authenticated roles cannot execute the wrapper directly. Old clients missing an accepted quote fail closed and must refresh.

## Validation

- Full Node test suite: 79/79 passed.
- TypeScript validation: passed.
- Targeted ESLint: no errors; three pre-existing Dashboard warnings (unused import and image guidance).
- Added missing-budget fail-closed guard afterward; targeted SQL test passed again.
- Vercel production build: Ready.
- Production browser: dashboard images/labels retained; Start Investment opened the selected G5 Flex checkout; correct wallet funds and disabled purchase reasons rendered.
- No actual purchase or reward claim was submitted.

Read-only production state: PHP wallet available PHP30, Deposit Balance PHP0, business budget available PHP170, reserved PHP0, sales PHP0, and zero live investment contracts. Cheapest plan costs PHP200 with PHP50/day for 365 days, requiring PHP18,250 business reward reserve. Current funding is insufficient; checkout correctly blocks purchase. Member purchase funds must also reach the purchase price. Member deposits and product receipts must not be used to bypass the reward reserve requirement.

## Deployment and rollback

Only the eight listed application files were overlaid onto the previous deployed release in backups/live-product-purchase-release-2026-10-24. No unrelated dirty workspace changes or local credentials were uploaded. No environment flags were changed in this release.

To roll back the UI/API release, promote the prior deployment dpl_Fh8NSpwbUPsvR38asGf9WwFrmbXt (https://unify-fsjtdxwt5-agaw7.vercel.app) through Vercel. The additive quoted wrapper can remain unused; do not remove contracts, ledger records, or reset balances. Any purchases made after this release must remain recorded and reconciled even after a UI rollback.
