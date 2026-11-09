import { NextRequest } from 'next/server';
import { authenticate, handled, json, MoneyError } from '@/lib/money-server';
import { activeAuthUsers } from '@/lib/active-auth-users';
import { businessBudgetSummary } from '@/lib/business-budget-summary';

const datePH=(value:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
export function GET(request:NextRequest){return handled(async()=>{
 const {db,user}=await authenticate(request);
 const role=await db.from('profiles').select('role').eq('id',user.id).single();
 if(role.error || role.data?.role!=='admin')throw new MoneyError('Administrator required',403);
 const today=datePH(new Date().toISOString());
 let totalMembers=0,signupsToday=0,signinsToday=0,totalDeposits=0,depositsToday=0,verifiedDepositCount=0,pendingDeposits=0,pendingWithdrawals=0,totalWithdrawalsPaid=0,withdrawalsPaidToday=0;
 const readMembers=async()=>{
 const active = await activeAuthUsers(db);
 for(let offset=0;;offset+=500){
  const {data,error}=await db.from('profiles').select('id,role,created_at').order('id').range(offset,offset+499);
  if(error)throw new MoneyError('Unable to load live member totals',503);
  for(const p of data ?? []){
   const authUser=active.get(p.id);
   if (!authUser) continue;
   totalMembers++;
   if(datePH(p.created_at)===today)signupsToday++;
   if(p.role==='user' && authUser.last_sign_in_at && datePH(authUser.last_sign_in_at)===today)signinsToday++;
  }
  if((data?.length ?? 0)<500)break;
 }};
 const completedDeposits=new Map<string,number>();
 const completedWithdrawals=new Map<string,number>();
 const readPayments=async()=>{for(let offset=0;;offset+=500){
  const {data,error}=await db.from('money_transactions').select('id,kind,amount,status,created_at').order('id').range(offset,offset+499);
  if(error)throw new MoneyError('Unable to load live payment totals',503);
  for(const t of data ?? []){
   const amount=Number(t.amount);if(!Number.isSafeInteger(amount) || amount<0)throw new MoneyError('Invalid live payment amount',503);
   if(t.kind==='deposit' && t.status==='completed'){totalDeposits+=amount;verifiedDepositCount++;completedDeposits.set(t.id,amount);}
   if(t.kind==='deposit' && t.status==='pending')pendingDeposits+=amount;
   if(t.kind==='withdrawal' && t.status==='completed'){totalWithdrawalsPaid+=amount;completedWithdrawals.set(t.id,amount);}
   if(t.kind==='withdrawal' && ['pending','reserved','approved','processing'].includes(t.status))pendingWithdrawals+=amount;
  }
  if((data?.length ?? 0)<500)break;
 }};
 const [, , budget] = await Promise.all([readMembers(),readPayments(),
   db.from('money_business_budget').select('available,reserved,sales,funded').eq('id',true).single()]);
 if(budget.error || !budget.data)throw new MoneyError('Unable to load business rewards balance',503);
 let businessBudget;
 try{businessBudget=businessBudgetSummary(budget.data);}catch{throw new MoneyError('Business balance requires reconciliation',503);}
 let treasury=null;
 if(process.env.MANUAL_TREASURY_ENABLED==='true'){
  const result=await db.rpc('money_treasury_summary');
  if(result.error)throw new MoneyError('Unable to load recorded cash balances',503);
  treasury=result.data;
 }
 const counted=new Set<string>();
 for(let offset=0;;offset+=500){
  const {data,error}=await db.from('money_ledger').select('id,transaction_id,action,created_at').in('action',['deposit','settle']).order('id').range(offset,offset+499);
  if(error)throw new MoneyError('Unable to verify live deposit dates',503);
  for(const entry of data ?? []){
   if(counted.has(entry.transaction_id))continue;
   if(entry.action==='deposit' && completedDeposits.has(entry.transaction_id)){
    counted.add(entry.transaction_id);if(datePH(entry.created_at)===today)depositsToday+=completedDeposits.get(entry.transaction_id)!;
   }
   if(entry.action==='settle' && completedWithdrawals.has(entry.transaction_id)){
    counted.add(entry.transaction_id);if(datePH(entry.created_at)===today)withdrawalsPaidToday+=completedWithdrawals.get(entry.transaction_id)!;
   }
  }
  if((data?.length ?? 0)<500)break;
 }
 return json({treasury,businessBudget,manualPayments:process.env.MANUAL_PALAWAN_DEPOSITS_ENABLED==='true',currency:'PHP',timezone:'Asia/Manila',mode:'live',totalMembers,signupsToday,signinsToday,totalDeposits:totalDeposits/100,depositsToday:depositsToday/100,verifiedDepositCount,pendingDeposits:pendingDeposits/100,pendingWithdrawals:pendingWithdrawals/100,totalWithdrawalsPaid:totalWithdrawalsPaid/100,withdrawalsPaidToday:withdrawalsPaidToday/100});
});}
