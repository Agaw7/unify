import { NextRequest } from 'next/server';
import { authenticate, handled, json, MoneyError } from '@/lib/money-server';

export function GET(request: NextRequest) {
  return handled(async () => {
    const { db, user } = await authenticate(request);
    const { data: profile, error } = await db.from('profiles').select('role').eq('id', user.id).single();
    if (error || profile?.role !== 'admin') throw new MoneyError('Administrator required', 403);
    return json({
      automatedPaymentsAvailable: false,
      productionPaymentsAuthorized: false,
      message: 'Automated payment processing is unavailable. Use approved manual processes only.',
    });
  });
}
