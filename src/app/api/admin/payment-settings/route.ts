import { NextRequest } from 'next/server';
import { authenticate, handled, json } from '@/lib/money-server';
import { requiredPaymentApprovals, approvalBlockReason } from '@/lib/payment-readiness';

export function GET(request: NextRequest) {
  return handled(async () => {
    const { db } = await authenticate(request, 'role-only');
    const history = await db.from('payment_readiness_reviews').select('id,approval_type,status,evidence_reference,reviewed_at').order('reviewed_at', { ascending: false }).limit(50);
    return json({ environment: 'Production locked', liveCollection: false, liveWithdrawals: false,
      liveRewards: false, reason: approvalBlockReason,
      // Evidence rows alone cannot activate payment execution. No write API exists.
      approvals: requiredPaymentApprovals.map(([key, label]) => ({ key, label, status: 'Not independently verified' })),
      purposes: [], history: history.error ? null : history.data });
  });
}
