# Simulated withdrawal modes

Apply migration 13 after migration 02. Admin → Withdrawal Settings controls new
test withdrawal requests. The default is Admin Approval, preserving the current
workflow. Mode changes require a verified admin and record actor, old/new mode,
time, and version in an audit table. Stale version saves are rejected.

- Admin Approval: the balance is reserved once; status is `reserved`. Existing
  admin approval and simulated completion actions remain available.
- Automatic: eligible requests are deducted once and recorded `simulated_paid`
  in one database transaction. No real GCash/Maya transfer is made. The server
  requires `UNIFY_SANDBOX_PAYOUTS_ENABLED=true` and a PayMongo test key for this
  mode. The same gate is checked on every new automatic request.

Each request stores its `processing_mode`. Switching modes never changes older
requests. A retry with the same user/key returns the saved request, even after a
mode switch or disabled simulation flag, without deducting again. Account
ownership, limits, and balances are checked on the server and in the database.

Requests now go through authenticated `/api/withdrawals/sandbox`; direct client
execution of the old request RPC is revoked. The service-only replacement gets
the verified user ID and simulation flag from the server. The browser cannot
choose either. Existing clients must refresh after installing this migration.

These settings do not apply to the separate real PHP payout system.

Validation: `node --test tests/sandbox-withdrawal-modes.test.cjs tests/sandbox-withdrawal-mode-api.test.cjs`.
