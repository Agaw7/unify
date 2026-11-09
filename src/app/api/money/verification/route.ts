import { NextRequest } from 'next/server';
import { authenticate, handled, json, MoneyError } from '@/lib/money-server';
import { record, uuid } from '@/lib/money-validation';

export function POST(request:NextRequest) {
  return handled(async()=>{
    const { db,user }=await authenticate(request);
    const b=record(await request.json());
    if(typeof b.evidenceReference!=='string' || !/^[A-Za-z0-9][A-Za-z0-9 ._:/-]{4,119}$/.test(b.evidenceReference.trim()) || b.confirmed!==true) throw new MoneyError('Enter your secure review case reference (5–120 characters) and confirm the declaration');
    if(b.kind!=='identity' && b.kind!=='ownership') throw new MoneyError('Invalid verification type');
    if(b.kind==='ownership') {
      if(!uuid(b.destinationId)) throw new MoneyError('Recipient required');
      const { data:d,error }=await db.from('money_destinations').select('id').eq('id',b.destinationId).eq('user_id',user.id).single();
      if(error || !d) throw new MoneyError('Recipient not found',404);
    }
    const destination=b.kind==='ownership' ? b.destinationId : null;
    let query=db.from('money_verifications').select('id,status,expires_at').eq('user_id',user.id).eq('kind',b.kind).in('status',['submitted','pending','approved']);
    query=destination ? query.eq('destination_id',destination) : query.is('destination_id',null);
    const { data:existing,error:lookupError }=await query.maybeSingle();
    if(lookupError) throw new MoneyError('Unable to load verification',503);
    if(existing && (!existing.expires_at || Date.parse(existing.expires_at)>Date.now())) return json({ verification:existing });
    if(existing) {
      const { error }=await db.from('money_verifications').update({ status:'expired',updated_at:new Date().toISOString() }).eq('id',existing.id).eq('status','approved');
      if(error) throw new MoneyError('Unable to renew verification',409);
    }
    const { data:v,error }=await db.from('money_verifications').insert({ user_id:user.id,kind:b.kind,destination_id:destination,status:'submitted',evidence_reference:b.evidenceReference.trim() }).select('id,status').single();
    if(error) throw new MoneyError('Verification already submitted or unavailable. Refresh status.',409);
    return json({ verification:v,message:'Review requested. An administrator will check the evidence associated with your case reference. Submission does not enable payments.' });
  });
}
