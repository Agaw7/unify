# UNIFY PHP payments

> **Archived:** This guide describes a previous automated processor integration.
> That integration, credentials from repository-local environment files, and
> webhook handling have been removed. Do not configure or use the old credentials
> or procedures. Current payment status is in `../README.txt`.

**Payment operations update:** Apply `database/04_payment_operations.sql` after
`03_real_money.sql`. The update replaces immediate crediting with settlement
holds and requires current identity/ownership review records. See
[payment operations and acceptance](payment-operations.md) for the current
workflow, scheduling, refunds/disputes, and remaining launch requirements.

The live money module is isolated from historical sandbox balances and earnings.
`/money` is the user wallet. `/admin/money` is the operations dashboard. Sandbox
and test-payment interfaces, checkout, callbacks, and simulated wallet routes are
retired; historical records remain preserved and are not merged into live balances.
The live PHP wallet uses `/deposit` and remains paused until production authorization
is independently verified.
All amounts in `money_*` tables and ledger deltas are integer **centavos**.
The API accepts PHP amounts (for example `200.01`). No demo earnings, bonuses,
commissions, or investment return functions can credit this wallet.

## Deployment

1. Obtain provider approval for the specific investment business and supported
   GCash/Maya channels. Complete your business's required identity, compliance,
   privacy, and custody arrangements. This module does not issue investments.
2. Back up the database and review/apply `database/03_real_money.sql` once, followed
   by `database/04_payment_operations.sql`, in
   Supabase SQL Editor. It requires `public.profiles(id, role)` and Supabase Auth.
   Existing schema files do not fully describe every sandbox table currently
   referenced by the app; this migration intentionally does not depend on them.
3. Set server-only `SUPABASE_SERVICE_ROLE_KEY`, `PAYMONGO_LIVE_SECRET_KEY`, and
   `PAYMONGO_LIVE_WEBHOOK_SECRET`. Set `NEXT_PUBLIC_APP_URL` to your public HTTPS
   origin. Use a separate secret for the new live webhook endpoint.
4. Register `/api/payments/webhooks/paymongo` for
   `checkout_session.payment.paid`, `transfer.outward.successful`, and
   `transfer.outward.failed`. Keep the existing sandbox endpoints and credentials
   separate. This endpoint requires a live signature and independently retrieves
   the resource from PayMongo before moving balances. Provider account permissions
   and the event payload shape must be confirmed during acceptance testing.
5. Provision at least two administrator accounts through a trusted database
   operation. Administrators must enroll/verify TOTP using `/admin/money`.
   Never allow users to edit their own `profiles.role`; audit deployed profile
   policies and existing security-definer functions before production.
6. Leave `LIVE_PAYMENTS_ENABLED=false` and `LIVE_PAYOUTS_ENABLED=false` until
   acceptance checks pass. Enable deposits with `LIVE_PAYMENTS_ENABLED=true`.
7. For payouts, activate/fund a PayMongo wallet and configure
   `PAYMONGO_WALLET_ACCOUNT_NUMBER` and `PAYMONGO_WALLET_ACCOUNT_NAME` from its
   provisioned source account. Enable `LIVE_PAYOUTS_ENABLED=true` only after
   transfer access is confirmed. The business pays provider payout fees in
   addition to the user's withdrawal amount; maintain a fee reserve.

Do not point a test secret at this module. Rehearse with mocks and an isolated
database; the existing sandbox module remains available for test checkouts.
There has been no real provider transaction or remote migration as part of the
local implementation.

## Workflow and controls

- Submit recipient details and identity/ownership review requests from `/money`.
  The operations panel in `/admin/money` records review decisions, evidence,
  provider/process name, and an expiry. Old verified flags alone are insufficient.
  No hosted identity provider is connected until a provider is selected and its
  authenticated integration is implemented. Recipients are immutable snapshots after
  verification; saving a number never verifies ownership. An independent admin
  verifies the customer's identity and recipient ownership using your approved
  process, then records an internal evidence reference in `/admin/money`. Do not
  store identity documents in audit reasons. Obtain the correct institution BIC
  from PayMongo's supported receiving-institution list, not a guessed code.
- Customers can deposit PHP 200–50,000 and withdraw PHP 100–50,000. Requests are
  limited to 10 per customer per hour and PHP 100,000 per type in a rolling day.
  These conservative limits are enforced atomically in PostgreSQL and should be
  reviewed against your provider agreement. Rejected/failed requests still count
  toward the hourly attempt limit.
- Each request uses a UUID idempotency key. Replays return the original record;
  changing its amount, method, or destination causes a conflict. The browser
  retains an unresolved request key in session storage across page refreshes.
- A deposit enters held funds only for an actual matching live paid payment, including amount,
  currency, method, successful payment intent, reference and checkout ID.
  An administrator must confirm settlement report evidence before releasing held
  funds. Elapsed time is not settlement proof. A redirect or QR scan never credits money. A blocked customer's incoming paid
  deposit is still recorded correctly; their withdrawals remain blocked.
- A withdrawal moves available funds to reserved in the same transaction as its
  ledger entry. One administrator approves; a different administrator sends it.
  Rejection releases funds. A verified failed payout releases reserved funds;
  a verified successful payout consumes them. Replayed confirmations do not
  duplicate ledger entries. An unknown result keeps the reserve intact.
- No admin "mark paid" or manual wallet top-up exists. Client roles have no
  table-write or money-RPC permissions. All access is through authenticated
  server routes; admin routes additionally require AAL2 and a server-side role
  lookup. Service credentials and database owner access remain highly privileged.
- The admin list highlights large payments and delayed confirmations, shows
  recent audit entries, and supports customer restrictions. It displays the most
  recent 200 transactions/recipients/customers and 100 audit entries, not global
financial totals or a full fraud monitoring system.

## Reconciliation and incident handling

An external request and a database commit cannot share a transaction. Creation
claims are saved **before** contacting PayMongo. If a network timeout or database
write fails, the transaction stays `creating` (deposit) or `processing` (payout).
The API never automatically sends another provider request for that transaction.

Use **Verify with provider** in `/admin/money`. If the creation response was lost,
find the checkout/transfer in PayMongo by the UNIFY transaction UUID in its
`reference_number`, then enter its `cs_…` / `tr_…` ID in the recovery field.
Reconciliation re-fetches and validates that record before linking/settling it.
Never release a processing reserve on the basis of a timeout or missing webhook.
Never submit a second transfer to fix an unknown result. If no provider resource
can be found, escalate to provider support; this implementation deliberately has
no unsafe manual reset. A failed payout must be requested again with a new key.

Reconcile pending requests regularly and compare the UNIFY ledger with provider
reports and bank settlement records daily. A protected background reconciliation
endpoint and scheduler configuration are included; deployment and a valid
`CRON_SECRET` are required to activate scheduling. Operations alerts are stored in
the admin dashboard; external notifications are not connected. Turning off payment flags stops new submissions while signed webhooks and
reconciliation continue confirming funds already in flight. Retain the live
credentials and webhook secret until all outstanding records are reconciled.

Refund and dispute accounting, holds, and evidence reviews are now implemented;
provider payload compatibility still requires acceptance testing. Automated
identity/sanctions screening, long-term audit exports, and importing/matching
bank/provider settlement reports need further integration before public launch.
No live investment purchase/earnings integration is
included, so simulated investment returns remain non-withdrawable.

## Validation

Run `npm run test:money`, `npx tsc --noEmit`, and the targeted lint checks.
The database suite uses an ephemeral embedded PostgreSQL instance with mock Auth
users; it never touches your Supabase project. Before public rollout also verify
real provider webhook registration/delivery, KYC review, restricted customers,
merchant channel permissions, deposits, payout fees, pending/success/failure
statuses, network-loss recovery and daily reconciliation in your approved staging
and controlled launch process. Local tests cannot establish merchant approval or
validate the deployed database's pre-existing permissions.

Provider references:
- https://docs.paymongo.com/docs/payment-channels-hosted-checkout-quick-start
- https://docs.paymongo.com/docs/developer-tools-webhook-setup-management
- https://docs.paymongo.com/docs/money-movement-moving-money-with-api
- https://docs.paymongo.com/reference/transfer-resource
- https://www.paymongo.com/en/restricted-businesses
