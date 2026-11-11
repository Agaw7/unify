import { NextRequest } from 'next/server';
import { authenticate, handled, json, MoneyError } from '@/lib/money-server';
import { activeAuthUsers } from '@/lib/active-auth-users';
import { productionPaymentsAuthorized } from '@/lib/payment-readiness';

export const dynamic = 'force-dynamic';

function schemaNotReady(error: { code?: string; message?: string }) {
  return ['42703', '42P01', 'PGRST200', 'PGRST204', 'PGRST205'].includes(error.code ?? '') ||
    /schema cache|column .* does not exist|relation .* does not exist/i.test(error.message ?? '');
}

export function GET(request: NextRequest) {
  return handled(async () => {
    const { db, user } = await authenticate(request, 'role-only');
    if (request.nextUrl.searchParams.get('hideRecords') === 'true') {
      return json({
        transactions: [],
        recordsHidden: true,
        manualWithdrawalsEnabled: process.env.MANUAL_GOTYME_WITHDRAWALS_ENABLED === 'true',
        canConfirmPayout: productionPaymentsAuthorized && process.env.MANUAL_GOTYME_WITHDRAWALS_ENABLED === 'true',
      });
    }
    const [transactions, accounts] = await Promise.all([
      db.from('money_transactions')
        .select('id,user_id,method,amount,withdrawal_fee,status,created_at,destination_snapshot,reviewed_by')
        .eq('kind', 'withdrawal')
        .order('created_at', { ascending: false })
        .limit(500),
      activeAuthUsers(db),
    ]);
    if (transactions.error) {
      console.error('Withdrawal records query failed', { code: transactions.error.code });
      throw new MoneyError('Unable to load withdrawal records. Verify the money schema migrations and try again.', 503);
    }
    const ids = (transactions.data ?? []).map(transaction => transaction.id);
    let payoutDetails = new Map<string, { payout_proof_path: string | null; payout_confirmed_at: string | null }>();
    if (ids.length) {
      const details = await db.from('money_transactions')
        .select('id,payout_proof_path,payout_confirmed_at')
        .in('id', ids);
      if (details.error && !schemaNotReady(details.error)) {
        console.error('Withdrawal proof metadata query failed', { code: details.error.code });
        throw new MoneyError('Unable to load withdrawal proof details', 503);
      }
      if (!details.error) {
        payoutDetails = new Map((details.data ?? []).map(row => [row.id, row]));
      }
    }
    const members = Object.fromEntries([...accounts].map(([id, user]) => [id, {
      phone: user.phone ?? null,
      name: typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : null,
    }]));
    return json({
      transactions: (transactions.data ?? []).map(transaction => {
        const payout = payoutDetails.get(transaction.id);
        return {
          ...transaction,
          canReject: ['reserved', 'approved'].includes(transaction.status) && transaction.user_id !== user.id,
          canRecordPayout: ['approved', 'processing'].includes(transaction.status) &&
            transaction.user_id !== user.id && Boolean(transaction.reviewed_by),
          payout_confirmed_at: payout?.payout_confirmed_at ?? null,
          hasPayoutProof: Boolean(payout?.payout_proof_path),
          member: members[transaction.user_id] ?? { phone: null, name: null },
        };
      }),
      manualWithdrawalsEnabled: process.env.MANUAL_GOTYME_WITHDRAWALS_ENABLED === 'true',
      canConfirmPayout: productionPaymentsAuthorized && process.env.MANUAL_GOTYME_WITHDRAWALS_ENABLED === 'true',
    });
  });
}
