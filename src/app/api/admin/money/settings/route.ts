import { NextRequest } from 'next/server';
import { authenticate, handled, json, MoneyError, rpc } from '@/lib/money-server';
import { record } from '@/lib/money-validation';

export function GET(request:NextRequest) {
  return handled(async()=>{
    const {db}=await authenticate(request,'role-only');
    const {data,error}=await db.from('money_settings').select('withdrawal_mode,updated_at').eq('id',true).single();
    if(error) throw new MoneyError('Apply withdrawal mode migration 17 before using these settings',503);
    return json(data);
  });
}
export function POST(request:NextRequest) {
  return handled(async()=>{
    const {user}=await authenticate(request,'role-only');
    const b=record(await request.json());
    if(b.mode!=='admin_approval' || typeof b.reason!=='string' || b.reason.trim().length<5 || b.reason.length>500) throw new MoneyError('Only Admin Approval mode is available. Supply a reason (5–500 characters)');
    await rpc('money_set_withdrawal_mode',{p_actor:user.id,p_mode:b.mode,p_reason:b.reason.trim()});
    return json({success:true});
  });
}
