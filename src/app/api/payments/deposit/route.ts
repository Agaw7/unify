import { NextRequest, NextResponse } from 'next/server';
import { authenticate, handled, json, MoneyError } from '@/lib/money-server';
import { uuid } from '@/lib/money-validation';

export const runtime = 'nodejs';

export function GET(request: NextRequest) {
  return handled(async () => {
    const { db, user } = await authenticate(request);
    const mode = request.nextUrl.searchParams.get('mode') ?? 'live';
    if (mode !== 'live') throw new MoneyError('Sandbox payment history is no longer available', 404);
    const id = request.nextUrl.searchParams.get('transactionId');
    if (id && !uuid(id)) throw new MoneyError('Invalid transaction reference');

    const [wallet, customer, readiness] = await Promise.all([
      db.from('money_wallets').select('available,deposit_available,reserved,held').eq('user_id', user.id).maybeSingle(),
      db.from('money_customers').select('verified,blocked').eq('user_id', user.id).maybeSingle(),
      db.rpc('money_deposit_ready', { p_user: user.id }),
    ]);
    if (wallet.error || customer.error || readiness.error) throw new MoneyError('PHP wallet is not available yet. Contact support.', 503);

    const available = Number(wallet.data?.available ?? 0) / 100;
    const held = Number(wallet.data?.held ?? 0) / 100;
    const depositBalance = Number(wallet.data?.deposit_available ?? 0) / 100;
    const balance = available + depositBalance + held + Number(wallet.data?.reserved ?? 0) / 100;
    const eligible = readiness.data === true && !customer.data?.blocked;
    let transaction = null;

    if (id) {
      const { data, error } = await db.from('money_transactions')
        .select('id,status').eq('id', id).eq('user_id', user.id).eq('kind', 'deposit').maybeSingle();
      if (error) throw new MoneyError('Unable to check payment status', 503);
      if (!data) throw new MoneyError('Deposit not found', 404);
      transaction = { id: data.id, status: data.status };
    }

    return json({ mode: 'live', enabled: false, eligible, balance, available, depositBalance, held, transaction });
  });
}

export function POST() {
  return NextResponse.json({ error: 'Test payment checkout is disabled.' }, { status: 404 });
}
