# Real PHP wallet dashboard cards

The owner selected replacing the two test balance cards with the actual PHP wallet balance, removing the old cards and their notes. This does not reset balances or convert test funds.

Application files changed:
- src/components/RealWalletSummary.tsx (new): reads authenticated /api/money, validates integer PHP centavos, formats available funds, refreshes on focus/pageshow, rejects stale responses and shows errors instead of fabricated zeroes.
- src/components/legacy/Dashboard.tsx: replaces both home/wallet test-card groups with this component and removes the redundant old wallet notice. Product purchase, portfolio simulation, claims, referral logic and all database records remain unchanged.

TypeScript passed. The existing 72 automated tests passed in the local workspace; ESLint reported no errors and three existing Dashboard warnings (unused History import and two img elements). No real deposit, payout or refund was submitted.

Automatic review rejected deploying the entire dirty workspace. A narrower deployment was approved: backups/php-wallet-release-2026-10-24 is a SHA-256-verified copy of the pre-audit production source snapshot with only the two application files above overlaid. This excludes unrelated unfinished audit changes. Production flags and credentials remain inherited from Vercel Production.

Deployment: dpl_75w29X3PMgUKACSJLzsZkzeAbZSd, https://unify-dx6bop5sz-agaw7.vercel.app.

Verified Ready with a 54-second production build and canonical alias unify-woad.vercel.app. Browser verification on the signed-in dashboard shows PHP Wallet · Available Balance = PHP 0.00, Manage PHP wallet and Refresh balance, with the former test balance cards/notes absent. Screenshot: real-php-wallet-dashboard.png. This is the member's actual available PHP wallet balance, not the merchant PayMongo Wallet balance or a frontend reset.

Rollback: redeploy the previous production version https://unify-a1uowngnt-agaw7.vercel.app with the existing production environment. Do not delete or rewrite financial records.
