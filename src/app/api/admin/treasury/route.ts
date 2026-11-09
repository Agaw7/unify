import {NextRequest} from 'next/server';
import {authenticate,handled,json,MoneyError,rpc} from '@/lib/money-server';
import {record,uuid} from '@/lib/money-validation';

function cents(value:unknown){
 if(typeof value!=='number' || !Number.isFinite(value))throw new MoneyError('Enter a valid PHP amount');
 const result=Math.round(value*100);
 if(!Number.isSafeInteger(result) || result<0 || result>100000000000 || Math.abs(value*100-result)>0.000001)throw new MoneyError('Enter a valid PHP amount with up to two decimal places');
 return result;
}
function enabled(){if(process.env.MANUAL_TREASURY_ENABLED!=='true')throw new MoneyError('Manual cash tracking is unavailable',503);}
export function GET(request:NextRequest){return handled(async()=>{
 enabled();const {db}=await authenticate(request,'role-only');
 const [summary,entries]=await Promise.all([rpc('money_treasury_summary',{}),db.from('money_treasury_entries').select('id,account_id,kind,delta,balance_after,reference,occurred_at,created_at').order('created_at',{ascending:false}).limit(100)]);
 if(entries.error)throw new MoneyError('Unable to load cash ledger',503);
 return json({summary,entries:entries.data});
});}
export function POST(request:NextRequest){return handled(async()=>{
 enabled();const {user}=await authenticate(request,true);const b=record(await request.json());
 if(!uuid(b.key) || b.confirmed!==true || typeof b.reference!=='string' || b.reference.trim().length<5 || b.reference.trim().length>100)throw new MoneyError('Confirmation, request key and statement/transfer reference required');
 const common={p_actor:user.id,p_key:b.key,p_reference:b.reference.trim(),p_confirm:true};
 if(b.action==='fund'){
  const id=await rpc('money_treasury_fund',{...common,p_amount:cents(b.amount)});
  try{await rpc('money_referrals_backfill',{});}catch{return json({id,message:'Rewards allocation recorded. Pending commissions need reconciliation; do not record this funding again.'});}
  return json({id,message:'Cash-backed rewards funding recorded. No bank transfer was performed.'});
 }
 if(typeof b.at!=='string' || !Number.isFinite(Date.parse(b.at)))throw new MoneyError('Enter the actual statement or transfer time');
 const at=new Date(b.at).toISOString();let summary;
 if(b.action==='open'){
  if(typeof b.allocate!=='boolean')throw new MoneyError('Choose whether to allocate uncommitted business cash');
  summary=await rpc('money_treasury_open',{...common,p_palawan:cents(b.palawan),p_gotyme:cents(b.gotyme),p_at:at,p_allocate:b.allocate,p_allocation_limit:b.allocate?cents(b.allocationLimit):0});
  if(b.allocate){try{await rpc('money_referrals_backfill',{});}catch{return json({summary,message:'Opening balances and allocation recorded. Pending commissions need reconciliation; do not repeat the opening entry.'});}}
 }else if(b.action==='reconcile'){
  if(!['palawan','gotyme'].includes(String(b.account)))throw new MoneyError('Choose the cash account');
  summary=await rpc('money_treasury_reconcile',{...common,p_account:b.account,p_balance:cents(b.balance),p_at:at});
 }else if(b.action==='transfer'){
  if(!['palawan','gotyme'].includes(String(b.from)) || !['palawan','gotyme'].includes(String(b.to)))throw new MoneyError('Choose both cash accounts');
  summary=await rpc('money_treasury_transfer',{...common,p_from:b.from,p_to:b.to,p_amount:cents(b.amount),p_fee:cents(b.fee),p_at:at});
 }else throw new MoneyError('Invalid cash ledger action');
 return json({summary,message:'Cash ledger recorded. No bank transfer was performed.'});
});}
