# Free welcome plans (Test Mode)

Apply `database/12_admin_free_plans.sql`, then open Admin → Free Plan. Select a
member and existing product, review its illustrative daily amount, and grant it.
There is one free welcome plan per member. Existing members can also receive
their first welcome plan; no artificial account-age cutoff is applied.

The API verifies the admin session and role. The service-only database function
checks the role again, locks the recipient profile, and inserts a portfolio item
and audit grant atomically. The caller-supplied admin ID is never accepted by the
API. An idempotency key makes retries safe, and a unique recipient constraint
prevents multiple admins from duplicating a welcome gift.

Product value and daily amount come from the database, not the browser. The
portfolio acquisition type is `admin_free_plan`; purchases remain `purchase`.
The product's retail value is recorded, but shown as a free plan in the portfolio.
The existing simulated daily-claim schedule applies from the grant date. This
feature never deducts a wallet balance, creates a deposit, awards referral
commissions, or processes a real-money payout.

Grant history is available to administrators through the API; members can read
only their own grant records. Recent history shows up to 100 grants. Member
selection uses the existing admin member list (up to 500 newest profiles).

Validation: `node --test tests/sandbox-free-plans.test.cjs`.
