# Change payment wallet after Back — 2026-10-25

> **Archived:** Hosted checkout and provider-confirmed expiry have been removed.
> `/deposit` is paused and the old change-wallet endpoint returns 404.

Deposit choices previously stayed disabled while any saved checkout was active. They are now selectable after initialization; choosing a different wallet asks the member to close the previous unpaid session first. The existing checkout remains available until provider-confirmed expiry succeeds. Unknown/paid/processing results preserve the old reference and block replacement. No new payment is created automatically by choosing a wallet.

The authenticated change-wallet endpoint scopes the transaction to the signed-in owner and deposit kind. It retrieves the exact live provider session and verifies the transaction reference, refuses paid/pending/processing payment attempts, calls the official expiry endpoint, then re-reads and requires expired status before marking the old uncredited deposit failed. Writes are conditional on matching reference and pending/creating state. Only after success does the frontend clear its saved checkout/request and select the new wallet. No balances or ledger credits are changed. No database migration or environment change.

Files: src/components/DepositPage.tsx; src/lib/deposit-expiry.ts; src/app/api/payments/deposit/change-wallet/route.ts; tests/money-deposit-expiry.test.cjs; this report. TypeScript passed; nine targeted tests passed (expiry safeguards, own-deposit scoping, existing deposit behavior). No real checkout was closed or payment submitted during testing.

Isolated release backups/change-deposit-wallet-release-2026-10-25 over prior deployment dpl_5pquLJwXh2dQP1rmdFFU7dkzY6MA. Rollback by promoting that prior deployment, preserving all financial records and statuses. Never re-open a provider-expired checkout.

Provider reference: https://docs.paymongo.com/reference/expire-a-checkout-session and https://docs.paymongo.com/docs/payment-channels-key-concepts .
Deployment dpl_DCy3zn9dB6MuBCTUvKWAe6DMuRut Ready; production build passed (44 seconds). Targeted ESLint passed.
