UNIFY SANDBOX SIMULATED WITHDRAWALS

1. Back up your database and code first.
2. Supabase SQL Editor: run 01_setup.sql.
3. Copy the three TypeScript files to the matching src/app paths.
4. In .env.local (server only):
   UNIFY_SANDBOX_PAYOUTS_ENABLED=true
   PAYMONGO_SECRET_KEY=sk_test_...  (keep your existing test secret)
5. Restart npm run dev, run npx tsc --noEmit.
6. /admin/transactions: Approve Withdrawal (reserved -> processing), then
   Mark Simulated Paid (processing -> completed). NO REAL MONEY IS SENT.
7. /admin: Rename the "Paid Withdrawals" metric title to
   "Simulated Paid Withdrawals". The API's totalWithdrawalsPaid now refers
   to SIMULATED sandbox payouts only. Never label this a real payout.
8. Refresh Statistics.

SQL verification:
SELECT wr.id, wr.status, pt.status AS transaction_status,
       sp.amount AS simulated_amount, sp.is_simulated
FROM public.withdrawal_requests wr
JOIN public.payment_transactions pt ON pt.id = wr.transaction_id
LEFT JOIN public.sandbox_withdrawal_payouts sp ON sp.withdrawal_request_id = wr.id
ORDER BY wr.created_at DESC LIMIT 10;

IMPORTANT:
- Does not debit wallet twice; initial reservation is the only debit.
- Does not call GCash, Maya, or PayMongo payout APIs.
- Sandbox payout records are NOT real provider verification.
- Keep this feature disabled in any live-money deployment.
- Check existing DB constraints allow withdrawal status 'completed'.
