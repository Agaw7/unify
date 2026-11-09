# PalawanPay cash balance reconciliation

Status: Migration 42 installed and application integration prepared for the existing production project. Both reported starting balances are PHP50,000. Opening cash entries and any rewards allocation remain pending the owner's final submission. Existing member balances have not been reset.

The existing business rewards budget is not an external PalawanPay cash balance. Do not relabel its current zero value as a verified PalawanPay balance.

Required accounting for the follow-up implementation:

- Establish an administrator-confirmed opening PalawanPay balance with a timestamp and statement/reference. The administrator submits the final financial ledger action themselves.
- Record confirmed inbound PalawanPay deposits once using their independently verified external reference. Pending orders and screenshots do not create cash.
- Separate physical cash from member liabilities. Crediting commissions, tier rewards, check-ins, gift codes or tasks increases the member's available balance and consumes eligible business funds; it does not itself send cash out of PalawanPay.
- Record an actual successful withdrawal once for the net amount sent plus any separately evidenced sending fee. A 5% platform withdrawal fee stays in the business account; it is not sent to the member. A pending, rejected or confirmed failed request does not represent cash paid out.
- Do not subtract a payout from PalawanPay if it was funded by a different wallet. Require a recorded source for every transfer.
- Account for manual top-ups, owner withdrawals, external spending, fees, reversals and refunds through independently referenced, audited reconciliation entries. Internal tier purchases do not move external cash a second time.
- Avoid opening-balance duplication: payments physically received before the opening timestamp but approved later must not be added again. Legacy records must be mapped to the opening statement before activating automatic cash posting.
- Preserve unique cash-event references and atomic transaction posting. Retrying approvals or completion cannot duplicate cash movement.
- Reward capacity must exclude existing member obligations and reserved rewards. Member deposits cannot be credited as member purchasing funds and simultaneously counted as unrestricted reward funding.
- Display a recorded/reconciled cash figure with its last reconciliation time; never claim live API synchronization without an official authorized connection.

No starting value has been assumed, no external bank funds verified, and no balance or allocation posted by this UI change.

Owner clarification: PalawanPay reported opening cash is PHP50,000; withdrawals are sent from GoTyme, not PalawanPay. The GoTyme opening amount is still required. Treat the PHP50,000 as owner-reported pending manual reconciliation, not API-verified cash. Incoming member deposits affect PalawanPay; successful outbound member transfers affect GoTyme. Internal funding transfers need matching debit/credit entries between accounts and do not change the combined balance. A payout from GoTyme must never be deducted from PalawanPay as though it was sent there. No opening ledger entry has been posted.


## Installed workflow

Migration: database/42_manual_treasury.sql. Server flag: MANUAL_TREASURY_ENABLED=true in production (default false in .env.example). Admin page: /admin/treasury; legacy /admin/business-budget redirects there in manual-treasury mode. Admin GET requests require an administrator role; all financial POST requests also require AAL2 MFA and explicit confirmation.

Opening forms are prefilled with the owner-reported PHP50,000 per account, not recorded money. Check actual statements and their exact cutoff time. The optional opening allocation is limited to the displayed maximum and existing member purchasing/available/reserved/held balances plus already-funded rewards and product receipts are excluded. The server rechecks capacity. Funding follows existing queued bonus and pending commission rules; no bank transfer is initiated.

PalawanPay approval requires the actual received time. GoTyme payout completion requires the actual sent time and any bank sending fee. The 5% platform fee stays in the business account: cash decreases by net payout plus actual sending fee. Cash movements already covered by the latest statement are recorded once with zero additional cash delta, avoiding opening-balance duplication. GoTyme transfer references are unique across receiving GCash and Maya methods.

Reconciliation records an audited difference against actual cash; material shortfalls raise a critical alert rather than modifying member balances. Confirmed internal transfers record both account sides atomically; only sending fees reduce combined cash. This is a manually reconciled ledger, not an official PalawanPay/GoTyme API connection. External activity must be reconciled.

Tests executed: isolated PostgreSQL/PGlite tests for opening idempotency and allocation cap, cross-network duplicate references, deposit and payout retry, statement cutoffs, failed payouts, net withdrawal fee accounting, internal transfer balance, shortfall alert and denied authenticated access. Reward tests also cover PHP5 credit once, insufficient funding and manual-mode tasks. TypeScript, changed-file lint and production build passed; existing legacy Dashboard lint warnings remain. No production cash or reward was posted by the agent.

Rollback: disable MANUAL_TREASURY_ENABLED and redeploy a known-good release to stop this cash-posting integration. Preserve account/entry tables, references and user records. Do not delete or reset ledger entries or member balances. Reconcile all payments since activation before re-enabling to avoid missing or duplicated movements. Existing approved member transactions remain authoritative.

Files: database/42_manual_treasury.sql; src/app/api/admin/treasury/route.ts; src/components/TreasuryAdmin.tsx; src/app/admin/treasury/page.tsx; src/app/admin/business-budget/page.tsx; src/app/api/admin/live-dashboard/route.ts; src/components/legacy/AdminHome.tsx; src/app/api/payments/deposit/manual/route.ts; src/components/ManualQrDepositReview.tsx; src/app/api/admin/money/route.ts; src/app/admin/money/page.tsx; .env.example; tests/money-treasury.test.cjs.
