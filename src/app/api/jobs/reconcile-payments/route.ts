import { timingSafeEqual } from 'node:crypto';
import { NextRequest } from 'next/server';
import { handled, json, MoneyError, rpc } from '@/lib/money-server';
import { runReconciliation } from '@/lib/money-operations';
import { productionPaymentsAuthorized } from '@/lib/payment-readiness';

export const runtime='nodejs';
export const maxDuration=120;
export function GET(request:NextRequest) {
  return handled(async()=>{
    const secret=process.env.CRON_SECRET;
    if(!secret || secret.length<32) throw new MoneyError('Reconciliation scheduler not configured',503);
    const expected=Buffer.from(`Bearer ${secret}`),received=Buffer.from(request.headers.get('authorization') ?? '');
    if(expected.length!==received.length || !timingSafeEqual(expected,received)) throw new MoneyError('Unauthorized scheduler',401);
    const tierRewards = productionPaymentsAuthorized ? await rpc('money_credit_due_tier_rewards', {}).catch(() => {
      console.error('Scheduled tier rewards could not be processed');
      return { status: 'failed' };
    }) : { status: 'paused_pending_approval' };
    return json({ ...await runReconciliation(), tierRewards });
  });
}
