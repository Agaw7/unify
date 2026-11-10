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
        canApprove: productionPaymentsAuthorized,
        treasuryEnabled: process.env.MANUAL_TREASURY_ENABLED === 'true',
      });
    }
    const [result, accounts] = await Promise.all([
      db.from('money_transactions')
        .select('id,user_id,method,amount,status,created_at')
        .eq('kind', 'deposit')
        .order('created_at', { ascending: false })
        .limit(500),
      activeAuthUsers(db),
    ]);
    if (result.error) {
      console.error('Deposit records query failed', { code: result.error.code });
      throw new MoneyError('Unable to load deposit records. Verify the money schema migrations and try again.', 503);
    }
    const ids = (result.data ?? []).map(transaction => transaction.id);
    const manualDetails = new Map<string, { instapay_reference: string; has_receipt: boolean }>();
    if (ids.length) {
      const manual = await db.from('manual_qrph_deposits')
        .select('transaction_id,instapay_reference,receipt_path,has_receipt')
        .in('transaction_id', ids);
      let legacy = false;
      if (manual.error && schemaNotReady(manual.error)) {
        const fallback = await db.from('manual_qrph_deposits')
          .select('transaction_id,instapay_reference')
          .in('transaction_id', ids);
        if (fallback.error && !['42P01', 'PGRST205'].includes(fallback.error.code ?? '')) {
          console.error('Manual deposit metadata query failed', { code: fallback.error.code });
          throw new MoneyError('Unable to load manual deposit details', 503);
        }
        if (!fallback.error) {
          for (const row of fallback.data ?? []) {
            manualDetails.set(row.transaction_id, { instapay_reference: row.instapay_reference, has_receipt: true });
          }
          legacy = true;
        }
      } else if (manual.error) {
        console.error('Manual deposit metadata query failed', { code: manual.error.code });
        throw new MoneyError('Unable to load manual deposit details', 503);
      } else {
        for (const row of manual.data ?? []) {
          manualDetails.set(row.transaction_id, {
            instapay_reference: row.instapay_reference,
            has_receipt: row.has_receipt === true || Boolean(row.receipt_path),
          });
        }
      }
      if (legacy) console.warn('Manual deposit metadata schema is older than migration 46; receipt paths are unavailable.');
    }
    const members = Object.fromEntries([...accounts].map(([id, user]) => [id, {
      phone: user.phone ?? null,
      name: typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : null,
    }]));
    const transactions = (result.data ?? []).map(transaction => {
      const manual = manualDetails.get(transaction.id);
      const channel = manual?.instapay_reference.startsWith('PALAWAN-') ? 'palawan'
        : manual?.instapay_reference.startsWith('GCASH-') ? 'gcash' : null;
      return {
        id: transaction.id,
        user_id: transaction.user_id,
        method: transaction.method,
        amount: transaction.amount,
        status: transaction.status,
        created_at: transaction.created_at,
        channel,
        submittedReference: manual?.instapay_reference ?? null,
        hasReceipt: manual?.has_receipt ?? false,
        ownDeposit: transaction.user_id === user.id,
        member: members[transaction.user_id] ?? { phone: null, name: null },
      };
    });
    return json({
      transactions,
      canApprove: productionPaymentsAuthorized,
      treasuryEnabled: process.env.MANUAL_TREASURY_ENABLED === 'true',
    });
  });
}
