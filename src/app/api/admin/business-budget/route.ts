import { NextRequest } from 'next/server';
import { authenticate, handled, json, MoneyError } from '@/lib/money-server';
import { record, uuid } from '@/lib/money-validation';

function enabled() {
  if (process.env.MANUAL_TREASURY_ENABLED !== 'true') throw new MoneyError('Verified cash-account tracking is not enabled.', 503);
}

export function GET(request: NextRequest) {
  return handled(async () => {
    const { db } = await authenticate(request, 'role-only');
    const hasTreasury = process.env.MANUAL_TREASURY_ENABLED === 'true';
    const [budget, funding] = await Promise.all([
      db.from('money_business_budget').select('available,reserved,sales,funded').eq('id', true).single(),
      db.from('money_business_funding').select('id,amount,reference,created_at').order('created_at', { ascending: false }).limit(50),
    ]);
    if (budget.error || funding.error) throw new MoneyError('Business budget migration 18 is required', 503);
    let cashSummary = null;
    if (hasTreasury) {
      const { data, error } = await db.rpc('money_treasury_summary');
      if (error) throw new MoneyError('Unable to verify recorded business cash. Apply treasury migrations first.', 503);
      cashSummary = data;
    }
    return json({ budget: budget.data, funding: funding.data, cashSummary, fundingEnabled: hasTreasury });
  });
}

export function POST(request: NextRequest) {
  return handled(async () => {
    enabled();
    const { db, user } = await authenticate(request, true);
    const body = record(await request.json());
    if (!uuid(body.key) || body.confirmed !== true
        || !['palawan', 'gotyme'].includes(String(body.account))
        || typeof body.at !== 'string' || !Number.isFinite(Date.parse(body.at))) {
      throw new MoneyError('Confirm the deposited amount, account, and time.');
    }
    if (typeof body.amount !== 'number' || !Number.isFinite(body.amount)) throw new MoneyError('Enter a valid PHP amount.');
    const amount = Math.round(body.amount * 100);
    if (!Number.isSafeInteger(amount) || amount < 10000 || amount > 100000000 || Math.abs(body.amount * 100 - amount) > 0.000001) {
      throw new MoneyError('Enter a deposit from ₱100.00 to ₱1,000,000.00.');
    }

    const { data, error } = await db.rpc('money_treasury_reward_deposit', {
      p_actor: user.id,
      p_account: body.account,
      p_amount: amount,
      p_key: body.key,
      p_reference: `RB-${body.key}`,
      p_at: new Date(body.at).toISOString(),
      p_confirm: true,
    });
    if (error) {
      const expected = [
        'Administrator required',
        'Confirm the verified business deposit details',
        'Opening balances must be confirmed first',
        'Deposit time must be after the latest account reconciliation',
        'Reward funding request conflict',
        'Reconcile cash shortfalls before funding the rewards budget',
        'Insufficient unallocated recorded cash',
        'Funding reference already allocated',
      ];
      throw new MoneyError(expected.find(message => error.message.includes(message)) ?? 'Reward budget deposit could not be confirmed. Refresh before retrying.', 409);
    }
    return json(data);
  });
}
