import { createHash, randomInt } from 'node:crypto';
import { NextRequest } from 'next/server';
import { authenticate, handled, json, MoneyError, rpc } from '@/lib/money-server';
import { record } from '@/lib/money-validation';
import { requireProductionApproval } from '@/lib/money-server';

const hash = (code: string) => createHash('sha256').update(code).digest('hex');
const giftCodeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const createGiftCode = () => `A-${Array.from({ length: 6 }, () => giftCodeAlphabet[randomInt(giftCodeAlphabet.length)]).join('')}`;
const isGiftCode = (code: string) => /^A-[A-Z0-9]{6}$/.test(code) || /^[0-9A-F]{24}$/.test(code);

export function GET(request: NextRequest) {
  return handled(async () => {
    const { user } = await authenticate(request);
    return json({ checkedIn: await rpc('money_check_in_status', { p_user: user.id }) });
  });
}

export function POST(request: NextRequest) {
  return handled(async () => {
    const body = record(await request.json());
    const { db, user } = await authenticate(request, body.action === 'create' ? 'role-only' : false);
    // Funded wallet rewards do not call the payment gateway. Keep their existing
    // database budget, account-restriction and duplicate-claim checks in force.
    if (body.action === 'create') {
      const code = createGiftCode();
      const { error } = await db.from('money_gift_codes').insert({
        code_hash: hash(code),
        created_by: user.id,
        max_claims: 50,
        expires_at: 'infinity',
      });
      if (error) throw new MoneyError('Unable to create gift code.', 503);
      return json({ code });
    }
    requireProductionApproval();
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
    if (body.action !== 'check-in' && (body.action !== 'redeem' || !isGiftCode(code))) throw new MoneyError('Enter a valid gift code.');
    const { data, error } = await db.rpc('money_claim_promo', {
      p_user: user.id,
      p_kind: body.action === 'check-in' ? 'check_in_reward' : 'gift_code_reward',
      p_code_hash: body.action === 'redeem' ? hash(code) : null,
      p_gift_amount: body.action === 'redeem'
        ? (randomInt(100) < 5 ? randomInt(6, 11) : randomInt(1, 6)) * 100
        : null,
    });
    if (error) {
      if (error.message.includes('Gift code is fully claimed')) {
        throw new MoneyError('This gift code has run out.', 409);
      }
      const known = ['Account restricted', 'Invalid or expired gift code', 'Insufficient funded business rewards budget'];
      throw new MoneyError(known.find(message => error.message.includes(message)) ?? 'Unable to claim reward.', 409);
    }
    return json(data);
  });
}
