# Home purchases, Assets, and daily rewards — 2026-10-24

The Home Start Investment button now opens a selected-product confirmation dialog without navigating to a separate catalog. The previous investments URL opens Assets. Products redirects to Home. Assets lists owned live contracts and claim controls only; successful purchases switch to Assets. The separate catalog header, wallet summary, and archive links were removed from that screen. Original simulated records remain accessible at /simulation-portfolio and /simulation-products.

Purchase authorization, accepted quote, full business reward reserve, idempotency, and server checks remain intact. Necessary purchase terms appear only in the confirmation dialog.

Existing money_investment_claim already calculates full 86,400-second periods from purchase time and credits money_wallets.available, not the purchase-only deposit bucket. No migration is needed. Claiming is manual through Assets; this release does not introduce automatic background crediting. Withdrawals retain balance, recipient, identity, and approval checks. Tests now explicitly cover no claim at 23h59m, one claim at 24h, available-balance credit, catch-up, and duplicate protection.

Modified application files: src/components/LiveInvestments.tsx; src/components/legacy/Dashboard.tsx; src/components/RealWalletSummary.tsx; src/app/investments/page.tsx; src/app/products/page.tsx; src/app/simulation-portfolio/page.tsx. Modified test: tests/money-funded-plans.test.cjs.

Validation: TypeScript passed. Three targeted database/API tests passed (funded plans, quoted purchase, live products API). No real purchase, claim, or payout executed. Deployment uses isolated backups/home-assets-release-2026-10-24 with only these application changes overlaid on the prior release. No environment or database changes.

Rollback: promote prior deployment dpl_F2YC9pjMyHeHxsgsEYAVrLxzxRHe in Vercel. Preserve all financial records and balances.

Production deployment dpl_GStGesCXaX6SBcwAmcWtu8a6TUD1 reached Ready; canonical alias https://unify-woad.vercel.app. Production build passed (49 seconds).
