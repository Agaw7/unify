# Production flag change — 2026-10-24

User explicitly requested live flags enabled after clarification.

Vercel project: agaw7/unify. Production configuration updated successfully:

- LIVE_PAYMENTS_ENABLED=true
- LIVE_PAYOUTS_ENABLED=true
- PAYMONGO_PAYOUT_ENABLE=true
- LIVE_REFUNDS_ENABLED=true

Redeployment uses the existing production source from unify-dcmso1idy-agaw7.vercel.app, not the unfinished local upgrade. New deployment: dpl_B7QEJ3ZepXDqeSHaFP7S3jU9jVGS (unify-8i3qpqctw-agaw7.vercel.app).

Verified Ready after a 53-second build; canonical aliases unify-woad.vercel.app and unify-agaw7.vercel.app point to this deployment.

No balances or accounts were edited and no payment, payout or refund was submitted by this configuration task. Authentication, identity/recipient approval, settlement, funds checks and administrator controls remain unchanged. Enabling flags does not validate provider configuration or turn sandbox balances into real money. The prior payout-source mismatch still requires provider verification.

To disable new live operations: set the four flags above false in Vercel Production and redeploy. Preserve reconciliation of transactions already submitted. Local environment files and .env.example defaults remain unchanged.
