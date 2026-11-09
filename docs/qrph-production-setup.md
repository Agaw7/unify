# UNIFY live QRPh setup

> **Archived:** The live QRPh/processor integration described here has been
> removed. The webhook path returns 404 and checkout is paused. Do not configure
> the credentials or follow the setup steps below. See `../README.txt` for the
> current status. Historical database records and migrations are retained.

Implemented: QRPh-only live deposits, signed provider verification, settlement
holds, and direct PayMongo payout scaffolding. Sandbox balances remain separate.
No production transfer or real payment has been performed as part of setup.

## Production environment (enter secrets directly in Vercel)

- PAYMONGO_LIVE_SECRET_KEY: the merchant's live secret from PayMongo Developers.
- PAYMONGO_LIVE_WEBHOOK_SECRET: secret for the exact live endpoint below.
- NEXT_PUBLIC_APP_URL: https://unify-woad.vercel.app
- CRON_SECRET: existing server secret; retain it.
- LIVE_PAYMENTS_ENABLED: keep false until configuration and acceptance checks pass.
- LIVE_PAYOUTS_ENABLED: keep false until external transfers, identity/ownership
  verification, MFA, independent administrators and source account are verified.
- PAYMONGO_PAYOUT_ENABLE: optional additional payout kill switch. False blocks
  payouts; true does not override LIVE_PAYOUTS_ENABLED or other requirements.
- PAYMONGO_WALLET_ACCOUNT_NUMBER / PAYMONGO_WALLET_ACCOUNT_NAME: provisioned
  PayMongo source wallet details, not a member's receiving wallet.

## Live webhook

URL: https://unify-woad.vercel.app/api/payments/webhooks/paymongo

Subscribe to checkout_session.payment.paid for hosted QRPh deposits.
For enabled transfers subscribe to transfer.outward.successful and
transfer.outward.failed. For refunds subscribe to payment.refunded and
payment.refund.updated. Confirm dispute notifications supported by the merchant's
account with PayMongo; configure dispute.created and dispute.resolved if available.
Keep the returned endpoint secret in Vercel, never in chat or source control.

After secrets are configured, redeploy before testing live webhook delivery.
A redirect, screenshot, or scan alone must never credit a wallet.

## Pages and prerequisites

- Customer QRPh deposit: /deposit?mode=live
- Customer real PHP wallet and recipient requests: /money
- Administrator operations and MFA: /admin/money
- Apply database/15_qrph_live_deposits.sql after migrations 03 and 04.
- After migration 16, identity approval is not required for deposits. Current
  identity and recipient-ownership approvals are required for withdrawals.
- New live investment purchases, live earnings and real deposit referral rewards
  are not integrated. Never convert simulated balances into real money or remove
  simulation labels from investment screens before implementing that accounting.
- Withdrawal amounts stay deducted from available funds while pending. Internal
  reserved accounting is retained to prevent double spending and duplicate refunds.

References:
https://docs.paymongo.com/docs/payment-channels-hosted-checkout-quick-start
https://docs.paymongo.com/docs/developer-tools-webhook-setup-management
https://docs.paymongo.com/docs/money-movement-quick-start
