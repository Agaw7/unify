# Payment operations and launch acceptance

> **Archived:** The automated payment-provider integration and webhook handlers
> described below have been removed. Do not follow provider setup or launch
> instructions in this historical document. Current status is in `README.txt`.

## Deploying this update

Local staging preparation creates an ignored `.env.staging.local` with a random
`CRON_SECRET` and financial flags disabled. Database/provider fields are empty
until the actual staging project is identified. Next.js does not automatically
load this staging-named file; supply its values explicitly to the staging host.
Check it without printing secret values with:
`npm run check:money-launch -- --env .env.staging.local`.
Do not copy production database/service credentials into staging.

1. Keep `LIVE_PAYMENTS_ENABLED`, `LIVE_PAYOUTS_ENABLED`, and
   `LIVE_REFUNDS_ENABLED` false while preparing staging.
2. Back up the database. Apply `database/03_real_money.sql` if it has not already
   been applied; then apply `database/04_payment_operations.sql` once.
   Do not re-run migration 03 on an existing schema.
3. Migration 04 does not invent settlement evidence or rewrite old balances.
   It restricts existing customers with available/reserved funds and creates
   critical review alerts for pre-hold completed deposits. Finance must review
   settlement reports, outstanding reservations and account restrictions before
   removing these restrictions. Fresh deposits go into `held`.
4. Configure a random `CRON_SECRET` of at least 32 characters. The authenticated
   endpoint is `GET /api/jobs/reconcile-payments`. Its caller must provide
   `Authorization: Bearer <CRON_SECRET>`. Never put the secret in a URL.
5. `vercel.json` requests reconciliation every five minutes after production
   deployment. Confirm the hosting plan supports that frequency before deploying;
   otherwise configure an approved external scheduler with the same header.
   Preview/local deployments do not automatically run the schedule. Verify the
   actual production invocation logs rather than assuming the file is active.
6. Register and validate supported refund and dispute events with PayMongo:
   `payment.refunded`, `payment.refund.updated`, `refund.succeeded`,
   `dispute.created`, `dispute.resolved`, plus the existing checkout/transfer
   events. The documentation lists differing refund event names, so confirm which
   names your account exposes. Test the actual payloads. Do not silently omit
   unsupported events; use provider reporting/reconciliation to cover gaps.
7. All administrative operations require MFA and the server-side admin role.
   Review and submit refunds with separate administrators. Keep
   `VERIFICATION_REVIEW_ENABLED=false` until your approved evidence review
   process is operational; changing the flag does not connect an identity provider.

## Identity and recipient ownership

Customers request identity or recipient ownership review at `/money`. Statuses
are submitted, pending, approved, rejected and expired. Active approvals must have
an expiry (at most one year). The `/admin/money` operations panel records the
approved process/provider, evidence reference, expiry and recipient BIC.
Use internal evidence references, not ID images, account credentials, or personal
identity documents in audit notes.

**External connection is pending:** No identity provider was selected or
approved in this session. No provider session, automated identity result, OTP
ownership check, or bank account-name match is claimed. Select the approved
provider, supply its server-side integration details through environment settings,
then implement its hosted session and authenticated result callbacks. Configure
data retention and consent through that process. A submitted request is not
verification. Manual review is available only when expressly enabled and backed
by your real approved process.

Every new financial request rechecks current approvals. Ownership approvals bind
to a saved destination. Changing its name, number, method or BIC expires that
approval; new requests cannot use it until it is reviewed again. The payout
sender also checks eligibility when claiming an approved withdrawal. Revoking
identity or ownership blocks future submissions, but cannot recall money already
submitted to a bank.

## Settlement and accounting

- `available`: customer funds eligible for withdrawal.
- `held`: paid deposits awaiting actual settlement evidence.
- `reserved`: funds reserved for withdrawals, refunds or disputes.
- `debt`: provider-confirmed reversal exposure that could not be covered by held
  or available funds. Debt restricts further financial requests.

A verified paid checkout credits held funds and creates a hold record. It does
not become available just because time passes. Finance checks the actual
provider/bank settlement report, records its reference, and uses **Release with
settlement evidence**. The server first checks payment refunds/dispute flags and
then atomically releases the remaining hold. Active cases or critical alerts
prevent release. Outstanding reversal debt is recovered first, with per-case
debt allocation so a later won dispute correctly restores recovered funds.
No automated bank-report importer or provider settlement-proof matcher is included.

## Refunds

An administrator enters the original deposit UUID, full/partial amount in PHP,
and case reference. The server atomically reserves funds from that deposit's
unreleased hold, then from available funds. It enforces refund totals and rejects
requests without sufficient refundable funds. Reservations have UUID idempotency
keys retained by the browser across refreshes. Start a distinct request by using
a new key only after confirming the earlier request's outcome.

A different administrator sends the refund when `LIVE_REFUNDS_ENABLED=true`.
Submission is claimed before the provider call. Requests use PayMongo's documented
`/refunds` endpoint, the original payment ID, and `metadata.adjustment_id` for
unambiguous recovery. The provider's returned record is independently retrieved,
checked for live mode, payment, amount, currency and status, then posted. Pending
and processing refunds remain reserved. Success consumes the reserve; failure
restores the original held/available buckets exactly once. Only a never-submitted
requested refund can be cancelled locally.

If the response is lost, do not submit again. Find the provider refund by its
metadata/notes and enter its `ref_…` ID in **Retrieve and verify refund**.
The database prevents another submission for a claimed refund. Provider-created
external refunds also reserve/deduct funds, record shortfalls when necessary, and
create blocking alerts for mismatches. Unexplained conflicts require review.

## Disputes

Signed live dispute events match a known original payment and reserve available
or deposit-held funds. Existing payout reservations are not taken back. A
shortfall becomes debt and a critical alert. Won disputes restore funds and clear
their debt; lost disputes consume the case reserve and preserve any unrecovered
debt. Duplicate/out-of-order events cannot apply the financial movement twice.
Conflicting terminal outcomes require investigation, not a guessed transition.

PayMongo's published sample dispute payloads may omit payment identifiers. If a
signed event lacks enough information to match it safely, the server stores a
critical unmatched-event alert. Such alerts restrict all financial processing
until investigated. An administrator must recover the matching provider evidence
and event; the code never guesses a customer from amount alone. Provider payment
records flagged disputed also cause conservative review alerts. Configure the
actual dispute schema/API with the provider before public launch.

## Reconciliation and alerts

The worker uses a database lease to prevent overlapping runs. Each run checks up
to 20 pending/completed payment records and 10 pending refunds, with a bounded
time budget and persisted progress. It retrieves provider state but never creates
another payout/refund to resolve an unknown result. Missing references are
flagged for recovery. Terminal verified refunds are not repeatedly fetched.

Critical alerts restrict affected customers. An unmatched critical event restricts
everyone until reviewed. Administrators acknowledge alerts only with evidence;
acknowledgment does not remove debt or resolve a live dispute. Alerts are visible
in `/admin/money`; email/Slack/SMS notifications are not connected. Monitor job
failures at the hosting layer and assign an operations owner. Aggregate provider
and bank settlement reports must still be compared daily by finance.

## Validation performed locally

- Embedded PostgreSQL tests run both migrations and exercise holds, refund
  reservation/success/failure, disputes during in-flight payouts, debt recovery,
  stale events, verification expiry, destination changes, client permissions and
  job leases.
- Mock provider tests verify incomplete dispute payload handling, live/test
  separation, unknown-reference alerts, and no refund retry after a timeout.
- `npm audit --omit=dev` reports **zero vulnerabilities** after overriding PostCSS
  to a compatible patched 8.5.31 release. The full audit still reports five high
  findings through development-only ESLint glob dependencies. `braces` 3.0.3 is
  still the latest registry release and is affected by GHSA-vfj7-8cjw-p6xm.
  Do not pass untrusted glob patterns to lint tooling. Recheck the advisory when
  a patched release is available; no forced downgrade/major migration was applied.

Run `npm run test:money`, `npx tsc --noEmit`, `npm run build`, and
`npm run check:money-launch`. The last command reports configuration readiness
without printing secrets or contacting a live financial account.

## Provider acceptance remains unverified

No remote database migration, provider onboarding, real payment, refund, payout,
identity check, or live acceptance test was performed. Before enabling flags,
record evidence for: approved merchant activities; supported channels and event
names; authenticated webhook delivery; pending/success/failure outcomes; original
payment refunds; timeouts and reference recovery; actual settlement reports;
verification and restriction enforcement; cron execution and alert response.
Use provider-approved staging/test fixtures before controlled live acceptance.
The module intentionally rejects test events on the live endpoint.

References:
- https://docs.paymongo.com/reference/refund-resource
- https://docs.paymongo.com/reference/create-a-refund
- https://docs.paymongo.com/reference/retrieve-a-refund
- https://docs.paymongo.com/docs/developer-tools-webhooks-events
- https://vercel.com/docs/cron-jobs/manage-cron-jobs
