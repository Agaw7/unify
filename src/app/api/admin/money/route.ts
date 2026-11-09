import { NextRequest } from 'next/server';
import { authenticate, handled, json, MoneyError, rpc } from '@/lib/money-server';
import { record, uuid } from '@/lib/money-validation';
import { requireProductionApproval } from '@/lib/money-server';

export const runtime = 'nodejs';
export function GET(request: NextRequest) {
  return handled(async () => {
    const { db } = await authenticate(request,'role-only');
    const results = await Promise.all([
      db.from('money_transactions').select('*').order('created_at',{ ascending:false }).limit(200),
      db.from('money_destinations').select('*').order('created_at',{ ascending:false }).limit(200),
      db.from('money_customers').select('*').order('updated_at',{ ascending:false }).limit(200),
      db.from('money_audit').select('*').order('created_at',{ ascending:false }).limit(100),
    ]);
    if (results.some(r => r.error)) throw new MoneyError('Unable to load money records',503);
    return json({ transactions:results[0].data,destinations:results[1].data,customers:results[2].data,audit:results[3].data,
      manualGoTyme: process.env.MANUAL_GOTYME_WITHDRAWALS_ENABLED === 'true',treasuryEnabled:process.env.MANUAL_TREASURY_ENABLED==='true' });
  });
}
export function POST(request: NextRequest) {
  return handled(async () => {
    const { db, user } = await authenticate(request,'role-only');
    const b = record(await request.json());
    if (['approve','payout','claim_manual_gotyme','claim_manual_qrph'].includes(String(b.action))) requireProductionApproval();
    if (b.action === 'compliance') {
      if (!uuid(b.userId) || typeof b.verified !== 'boolean' || typeof b.blocked !== 'boolean' || (b.destinationId != null && !uuid(b.destinationId)) || typeof b.reason !== 'string' || b.reason.trim().length<5) throw new MoneyError('Supply verification evidence and valid customer details');
      await rpc('money_compliance',{ p_actor:user.id,p_user:b.userId,p_verified:b.verified,p_blocked:b.blocked,p_destination:b.destinationId ?? null,p_bic:b.bic ?? null,p_reason:b.reason });
      return json({ success:true });
    }
    if (!uuid(b.id)) throw new MoneyError('Invalid transaction ID');
    if (b.action === 'claim_manual_gotyme' || b.action === 'record_manual_gotyme') {
      if (process.env.MANUAL_GOTYME_WITHDRAWALS_ENABLED !== 'true') throw new MoneyError('Manual withdrawals are unavailable',503);
      const { data: transaction, error } = await db.from('money_transactions').select('kind,method,withdrawal_mode').eq('id',b.id).single();
      if (error || transaction?.kind !== 'withdrawal' || !['gotyme','gcash','maya'].includes(transaction.method) || transaction.withdrawal_mode !== 'admin_approval') throw new MoneyError('Invalid manual withdrawal',409);
      if (b.action === 'claim_manual_gotyme') {
        await rpc('money_claim_payout', { p_id:b.id,p_actor:user.id });
      } else {
        if (b.confirm !== true || typeof b.reference !== 'string' || !/^[A-Z0-9-]{5,80}$/.test(b.reference) || !['succeeded','failed'].includes(String(b.status))) throw new MoneyError('Transfer reference, result and confirmation required');
        if(process.env.MANUAL_TREASURY_ENABLED==='true'){
          if(b.status==='succeeded' && (typeof b.sentAt!=='string' || !Number.isFinite(Date.parse(b.sentAt))))throw new MoneyError('Enter the actual GoTyme transfer time');
          const fee=typeof b.sendingFee==='number'?Math.round(b.sendingFee*100):0;
          if(!Number.isSafeInteger(fee) || fee<0 || fee>100000 || (typeof b.sendingFee==='number' && Math.abs(b.sendingFee*100-fee)>0.000001))throw new MoneyError('Enter the actual sending fee');
          if(b.status==='failed' && fee!==0)throw new MoneyError('Record any charged fee on a failed transfer through cash-account reconciliation before completing this record with zero additional fee');
          await rpc('money_treasury_complete_payout',{p_id:b.id,p_actor:user.id,p_reference:b.reference,p_status:b.status,p_confirm:true,p_sent_at:b.status==='succeeded'?new Date(String(b.sentAt)).toISOString():null,p_sending_fee:b.status==='succeeded'?fee:0});
        }else await rpc('money_record_manual_gotyme', { p_id:b.id,p_actor:user.id,p_reference:b.reference,p_status:b.status,p_confirm:true });
      }
      return json({ success:true });
    }
    if (b.action === 'approve' || b.action === 'reject') {
      if (typeof b.reason !== 'string' || b.reason.trim().length<5) throw new MoneyError('Review reason required');
      await rpc('money_review',{ p_id:b.id,p_actor:user.id,p_action:b.action,p_reason:b.reason });
      return json({ success:true });
    }
    const { data: t, error } = await db.from('money_transactions').select('*').eq('id',b.id).single();
    if (error || !t) throw new MoneyError('Transaction not found',404);
    if (b.action === 'reconcile') throw new MoneyError('Automated verification is unavailable. Confirm the transaction against the official account record and use the manual review action.',503);
    if (b.action === 'payout' && t.kind === 'withdrawal') throw new MoneyError('Automated payouts are unavailable. Record confirmed manual transfer results.',503);
    throw new MoneyError('Invalid action');
  });
}
