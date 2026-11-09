import { NextRequest } from 'next/server';
import { authenticate, handled, json, MoneyError, requireProductionApproval } from '@/lib/money-server';

export function POST(request: NextRequest) {
  return handled(async () => {
    const { db, user } = await authenticate(request);
    requireProductionApproval();
    const { data, error } = await db.rpc('money_registration_bonus', { p_user: user.id });
    if (error) {
      if (error.message.includes('Registration bonus is awaiting business funding')) {
        throw new MoneyError('Registration bonus is awaiting business funding.', 409);
      }
      if (error.message.includes('Account restricted')) throw new MoneyError('Account restricted', 403);
      console.error('Registration bonus grant failed', { code: error.code });
      throw new MoneyError('Registration bonus could not be confirmed. Refresh before retrying.', 503);
    }
    return json({ transactionId: data });
  });
}
