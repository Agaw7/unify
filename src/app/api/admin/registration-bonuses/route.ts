import { NextRequest } from 'next/server';
import { authenticate, handled, json, MoneyError } from '@/lib/money-server';
import { record, uuid } from '@/lib/money-validation';

export function GET(request: NextRequest) {
  return handled(async () => {
    const { db, user } = await authenticate(request, true);
    const { data, error } = await db.rpc('money_registration_bonus_overview', { p_actor: user.id });
    if (error) throw new MoneyError('Unable to load registration bonus records.', 503);
    return json({ bonuses: data });
  });
}

export function POST(request: NextRequest) {
  return handled(async () => {
    const { db, user } = await authenticate(request, true);
    const body = record(await request.json());
    if (!uuid(body.userId) || !uuid(body.key) || typeof body.reason !== 'string' || body.reason.trim().length < 5 || body.reason.trim().length > 300) {
      throw new MoneyError('Choose a member and enter a reclaim reason (5–300 characters).');
    }
    const { data, error } = await db.rpc('money_registration_bonus_reclaim', {
      p_actor: user.id, p_user: body.userId, p_key: body.key, p_reason: body.reason.trim(),
    });
    if (error) {
      const expected = [
        'Registration bonus not found',
        'Member has a completed deposit or approved identity; bonus cannot be reclaimed',
        'Bonus is spent, reserved, or has financial activity requiring review',
        'Unspent bonus balance could not be confirmed',
      ];
      throw new MoneyError(expected.find(message => error.message.includes(message)) ?? 'Bonus reclaim could not be confirmed. Refresh its status before retrying.', 409);
    }
    return json({ transactionId: data });
  });
}
