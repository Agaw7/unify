# Official e-wallet deposit flow — 2026-10-24

> **Archived:** The hosted-checkout integration described below has been
> removed. Deposits are currently paused; see `../README.txt`.

User confirmed direct GCash and Maya are activated. Deposit now offers GCash, Maya, and QRPh. UNIFY creates a selected-method PayMongo Hosted Checkout: gcash → gcash, maya → paymaya, qrph → qrph. Authentication, app opening, payment QR and authorization remain on the official provider-controlled checkout. UNIFY does not collect wallet passwords/OTPs or clone the third-party login screenshots. The URL QR formerly shown by UNIFY was removed to avoid confusing a website-link QR with a payment QR.

Existing saved checkout references are retained. A pending checkout locks selection until resolved; this prevents replacing an uncertain payment. Verified webhook matching, amount/currency checks, idempotency, settlement holds, dashboard return links, identity/recipient withdrawal requirements, and rate limits remain.

Migration 24 updates only the service-only money_request deposit method allowlist to permit GCash/Maya alongside QRPh. The deployed method constraint already permits these methods. No records, balances, or transactions are changed by applying the migration. Production SQL editor reported Success. Browser roles cannot call the financial function.

Files: database/24_live_ewallet_deposits.sql; src/app/api/money/route.ts; src/components/DepositPage.tsx; src/components/deposit.module.css; tests/money-live-ewallet-deposits.test.cjs; this report. TypeScript, targeted ESLint, and 13 targeted tests passed. Tests cover each live method, duplicate requests/credits, method conflict, held funds, blocked users, invalid methods, signatures and payment verification. No real checkout/payment was created by the agent; end-to-end wallet authorization remains for the user to test.

Isolated release backups/ewallet-deposit-release-2026-10-24. Rollback: promote prior deployment dpl_51n1VsrBiyzkt4WUCDjxeJvUKG2e, leaving records and additive method support intact. Do not invalidate outstanding GCash/Maya sessions during rollback.

Provider references: https://docs.paymongo.com/docs/payment-channels-hosted-checkout and https://docs.paymongo.com/docs/payment-acceptance-e-wallets . The provider controls the final wallet UI and exact app-opening behavior.
Deployment dpl_5pquLJwXh2dQP1rmdFFU7dkzY6MA Ready; production build passed (52 seconds); canonical alias updated. Browser verified GCash/Maya/QRPh choices without creating a checkout or authorizing payment.
