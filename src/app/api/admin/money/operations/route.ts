import { NextRequest } from 'next/server';
import { authenticate, handled, json, MoneyError, rpc } from '@/lib/money-server';
import { observeRefund, runReconciliation, submitRefund } from '@/lib/money-operations';
import { record, uuid } from '@/lib/money-validation';

export const runtime='nodejs';
export const maxDuration=120;
export function GET(request:NextRequest) {
  return handled(async()=>{
    const settlementOnly=request.nextUrl.searchParams.get('view')==='deposit-settlement';
    const { db }=await authenticate(request,'role-only');
    const holds=db.from('money_holds').select('*,money_transactions(user_id,amount,payment_id)').eq('released',false).limit(200);
    if(settlementOnly) {
      const { data,error }=await holds;
      if(error) throw new MoneyError('Unable to load deposits held for settlement',503);
      return json({ holds:data });
    }
    const results=await Promise.all([
      db.from('money_verifications').select('*').order('created_at',{ ascending:false }).limit(200),
      holds,
      db.from('money_adjustments').select('*').order('created_at',{ ascending:false }).limit(200),
      db.from('money_alerts').select('*').eq('resolved',false).order('created_at',{ ascending:false }).limit(200),
    ]);
    if(results.some(r=>r.error)) throw new MoneyError('Apply payment operations migration before using this screen',503);
    return json({ verifications:results[0].data,holds:results[1].data,adjustments:results[2].data,alerts:results[3].data,reviewEnabled:process.env.VERIFICATION_REVIEW_ENABLED==='true' });
  });
}
export function POST(request:NextRequest) {
  return handled(async()=>{
    const b=record(await request.json());
    const { db,user }=await authenticate(request,b.action==='release' ? 'role-only' : true);
    if(b.action==='reconcile') return json(await runReconciliation());
    if(b.action==='refund_verify') {
      if(typeof b.reference!=='string') throw new MoneyError('Refund reference required');
      await observeRefund(b.reference);return json({ success:true });
    }
    if(typeof b.reason!=='string' || b.reason.trim().length<5 || b.reason.length>500) throw new MoneyError('Evidence or case reference required (5–500 characters)');
    if(b.action==='alert_resolve') {
      if(typeof b.key!=='string') throw new MoneyError('Alert key required');
      await rpc('money_alert_resolve',{ p_key:b.key,p_actor:user.id,p_evidence:b.reason });return json({ success:true });
    }
    if(!uuid(b.id)) throw new MoneyError('Valid record ID required');
    if(b.action==='verification') {
      if(process.env.VERIFICATION_REVIEW_ENABLED!=='true') throw new MoneyError('Verification review is disabled until your approved process is configured',503);
      const { data:review,error:reviewError }=await db.from('money_verifications').select('user_id,kind,status').eq('id',b.id).single();
      if(reviewError || !review) throw new MoneyError('Verification request not found',404);
      if(review.user_id===user.id) throw new MoneyError('Another administrator must review your verification request',403);
      if(b.status==='approved' && !['submitted','pending'].includes(review.status)) throw new MoneyError('Only a pending request can be approved. Refresh the review queue.',409);
      if(b.status==='approved' && b.evidenceChecked!==true) throw new MoneyError('Confirm that identity or recipient ownership evidence was checked');
      if(typeof b.provider!=='string' || b.provider.trim().length<2 || b.provider.length>100) throw new MoneyError('Enter the review process name (2–100 characters)');
      if(b.status==='approved' && (Date.parse(String(b.expires))<=Date.now() || Date.parse(String(b.expires))>Date.now()+365*86400000)) throw new MoneyError('Approval expiry must be in the future and within one year');
      if(review.kind==='ownership' && b.status==='approved' && (typeof b.bic!=='string' || !/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(b.bic))) throw new MoneyError('Verified receiving institution BIC required');
      if(!['approved','rejected','expired'].includes(String(b.status)) || typeof b.provider!=='string' || typeof b.expires!=='string' || !Number.isFinite(Date.parse(b.expires))) throw new MoneyError('Provider, decision, and expiry required');
      await rpc('money_verification_decide',{ p_id:b.id,p_actor:user.id,p_status:b.status,p_provider:b.provider,p_evidence:b.reason,p_expires:b.expires,p_bic:b.bic ?? null });return json({ success:true });
    }
    if(b.action==='release') {
      const { data:t,error }=await db.from('money_transactions').select('payment_id,user_id').eq('id',b.id).eq('kind','deposit').single();
      if(error || !t) throw new MoneyError('Deposit not found',404);
      if(t.user_id===user.id) throw new MoneyError('Another administrator must approve your deposit',403);
      await rpc('money_release_hold',{ p_id:b.id,p_actor:user.id,p_evidence:b.reason });
      return json({ success:true });
    }
    if(b.action==='refund_request') {
      if(!uuid(b.key) || typeof b.amount!=='number' || !Number.isSafeInteger(b.amount) || b.amount<100 || b.amount>5000000) throw new MoneyError('Refund amount must be integer centavos (minimum ₱1) and have an idempotency key');
      const adjustment=await rpc('money_adjustment_open',{ p_id:b.id,p_kind:'refund',p_amount:b.amount,p_key:b.key,p_reference:null,p_actor:user.id,p_reason:b.reason });
      return json({ adjustment });
    }
    if(b.action==='refund_send') { await submitRefund(b.id,user.id);return json({ success:true }); }
    if(b.action==='refund_cancel') { await rpc('money_cancel_refund',{ p_id:b.id,p_actor:user.id,p_reason:b.reason });return json({ success:true }); }
    throw new MoneyError('Invalid operations action');
  });
}
