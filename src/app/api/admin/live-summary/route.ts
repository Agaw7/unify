import { NextRequest } from 'next/server';
import { authenticate, handled, json, MoneyError } from '@/lib/money-server';

export function GET(request:NextRequest){
  return handled(async()=>{
    const {db,user}=await authenticate(request);
    const {data:profile,error:roleError}=await db.from('profiles').select('role').eq('id',user.id).single();
    if(roleError || profile?.role!=='admin')throw new MoneyError('Administrator required',403);
    const {count,error:membersError}=await db.from('profiles').select('id',{count:'exact',head:true});
    if(membersError)throw new MoneyError('Unable to load members',503);
    let deposits=0,paid=0,pending=0,depositCount=0;
    for(let offset=0;;offset+=500){
      const {data,error}=await db.from('money_transactions').select('id,kind,amount,status').order('id').range(offset,offset+499);
      if(error)throw new MoneyError('Unable to load payment totals',503);
      for(const t of data ?? []){
        if(t.kind==='deposit' && t.status==='completed'){deposits+=Number(t.amount);depositCount++;}
        if(t.kind==='withdrawal' && t.status==='completed')paid+=Number(t.amount);
        if(t.kind==='withdrawal' && ['reserved','approved','processing'].includes(t.status))pending+=Number(t.amount);
      }
      if((data?.length ?? 0)<500)break;
    }
    return json({members:count ?? 0,deposits,paid,pending,depositCount});
  });
}
