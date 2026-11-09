import { NextRequest } from 'next/server';
import { authenticate, handled, json, MoneyError, rpc } from '@/lib/money-server';
import { requireProductionApproval } from '@/lib/money-server';
export function GET(request:NextRequest){return handled(async()=>{
 const {user}=await authenticate(request);
 const tasks = await rpc('money_daily_tasks',{p_user:user.id}) as {threshold: number}[];
 return json({tasks:tasks.filter(task => task.threshold !== 5)});
});}
export function POST(request:NextRequest){return handled(async()=>{
 const {user,db}=await authenticate(request);
 requireProductionApproval();
 const body=await request.json();
 if(![10,20,30,50].includes(body?.threshold))throw new MoneyError('Invalid daily task milestone');
 const {data,error}=await db.rpc('money_daily_task_claim',{p_user:user.id,p_threshold:body.threshold});
 if(error){
  const message=['Invalid daily task milestone','Daily task milestone is locked','Insufficient funded business rewards budget','Account restricted'].find(m=>error.message.includes(m));
  throw new MoneyError(message ?? 'Claim could not be confirmed. Refresh tasks before retrying.',409);
 }
 return json(data);
});}
