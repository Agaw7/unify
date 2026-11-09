'use client';
import Link from 'next/link';
import {useCallback,useEffect,useRef,useState} from 'react';
import {moneyRequest} from '@/lib/money-client';
import MoneyAdminMFA from '@/components/MoneyAdminMFA';

type Account={id:'palawan'|'gotyme';balance:number;reconciled_at:string|null;reference:string|null};
type Summary={ready:boolean;cash:number;liabilities:number;unallocated:number;rewardAvailable:number;rewardReserved:number;sales:number;shortfall:number;accounts:Account[]};
type Entry={id:string;account_id:string;kind:string;delta:number;balance_after:number;reference:string;occurred_at:string};
type State={summary:Summary;entries:Entry[]};
const php=(v:number)=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(v)/100);
const name=(id:string)=>id==='palawan'?'PalawanPay':'GoTyme';
const field='mt-2 block w-full min-w-0 rounded-xl border border-slate-600 bg-slate-900 p-3';
const button='rounded-xl bg-cyan-400 px-5 py-3 font-semibold text-slate-950 disabled:opacity-40';
function localNow(){const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,19);}
export default function TreasuryAdmin(){
 const [data,setData]=useState<State|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [palawan,setPalawan]=useState('50000'),[gotyme,setGotyme]=useState('50000'),[at,setAt]=useState(''),[reference,setReference]=useState(''),[confirmed,setConfirmed]=useState(false),[allocate,setAllocate]=useState(false);
 const [fund,setFund]=useState('100'),[account,setAccount]=useState('palawan'),[balance,setBalance]=useState(''),[from,setFrom]=useState('palawan'),[transferAmount,setTransferAmount]=useState(''),[fee,setFee]=useState('0');
 const lock=useRef(false);
 const load=useCallback(async()=>{try{setData(await moneyRequest('/api/admin/treasury'));}catch(e){setError(e instanceof Error?e.message:'Unable to load cash ledger');}},[]);
 useEffect(()=>{setAt(localNow());void load();},[load]);
 const s=data?.summary;
 const proposed=(Number(palawan)+Number(gotyme))*100;
 const cap=s?Math.min(100000000,Math.max(0,Math.floor(proposed)-Number(s.liabilities)-Number(s.rewardAvailable)-Number(s.rewardReserved)-Number(s.sales))):0;
 async function submit(action:'open'|'fund'|'reconcile'|'transfer'){
  if(lock.current || !confirmed || !s)return;
  const details=action==='open'?`Record ${php(Math.round(Number(palawan)*100))} in PalawanPay and ${php(Math.round(Number(gotyme)*100))} in GoTyme as the verified opening snapshot?${allocate?` Allocate up to ${php(cap)} of uncommitted business cash to rewards. Existing funding rules may credit eligible queued registration bonuses and pending commissions.`:''}`:action==='fund'?`Allocate ${php(Math.round(Number(fund)*100))} of uncommitted recorded cash to member rewards, including eligible queued bonuses and pending commissions?` : action==='reconcile'?`Replace the recorded ${name(account)} cash balance with the actual statement balance of ${php(Math.round(Number(balance)*100))}? The difference will be audited.`:`Record the already completed ${php(Math.round(Number(transferAmount)*100))} transfer from ${name(from)} to ${name(from==='palawan'?'gotyme':'palawan')}, plus ${php(Math.round(Number(fee)*100))} sending fee?`;
  if(!window.confirm(details+' This records ledger entries; it does not move money in any bank or e-wallet.'))return;
  lock.current=true;setBusy(true);setError('');setNotice('');
  try{
   const body={action,reference:reference.trim(),confirmed:true,at:at?new Date(at).toISOString():null,...(action==='open'?{palawan:Number(palawan),gotyme:Number(gotyme),allocate,allocationLimit:cap/100}:action==='fund'?{amount:Number(fund)}:action==='reconcile'?{account,balance:Number(balance)}:{from,to:from==='palawan'?'gotyme':'palawan',amount:Number(transferAmount),fee:Number(fee)})};
   const fingerprint=JSON.stringify(body),saved=sessionStorage.getItem('aurevia-treasury-request');let pending=saved?JSON.parse(saved):null;
   if(!pending || pending.fingerprint!==fingerprint)pending={fingerprint,key:crypto.randomUUID()};
   sessionStorage.setItem('aurevia-treasury-request',JSON.stringify(pending));
   const result=await moneyRequest('/api/admin/treasury',{...body,key:pending.key});
   sessionStorage.removeItem('aurevia-treasury-request');setNotice(result.message);setReference('');setConfirmed(false);await load();
  }catch(e){setError(e instanceof Error?e.message:'Unable to confirm ledger entry. Refresh before retrying.');}
  finally{lock.current=false;setBusy(false);}
 }
 return <main className="min-h-screen p-5"><div className="mx-auto max-w-4xl space-y-6">
  <Link href="/admin">← Back to Admin</Link><header><h1 className="text-3xl font-bold">Cash accounts</h1><p className="mt-2">PalawanPay receives deposits. GoTyme sends withdrawals. Balances are manually reconciled against official account history.</p></header>
  {error&&<p role="alert" className="rounded-xl bg-red-950 p-4">{error}</p>}{notice&&<p role="status" className="rounded-xl bg-cyan-950 p-4">{notice}</p>}
  <button disabled={busy} className={button} onClick={()=>void load()}>Refresh cash ledger</button>
  {s&&<>
   <section className="rounded-3xl border border-slate-700 bg-slate-900 p-6"><p>Combined recorded cash balance</p><h2 className="mt-3 text-4xl font-bold">{s.ready?php(s.cash):'Opening confirmation required'}</h2><div className="mt-5 grid gap-4 sm:grid-cols-2">{s.accounts.map(a=><div key={a.id}><h3 className="font-semibold">{name(a.id)}</h3><p className="mt-2 text-2xl font-semibold">{a.reconciled_at?php(a.balance):'Not confirmed'}</p><p className="mt-1 text-xs">{a.reconciled_at?`Last statement: ${new Date(a.reconciled_at).toLocaleString('en-PH')}`:'Owner-reported starting amount: ₱50,000.00; not yet recorded'}</p></div>)}</div></section>
   {Number(s.shortfall)>0&&s.ready&&<p role="alert" className="rounded-xl bg-red-950 p-4">Cash shortfall against existing obligations: {php(s.shortfall)}. Reconcile actual funds before allocating rewards.</p>}
   <MoneyAdminMFA onVerified={()=>void load()}/>
   <section className="space-y-4 rounded-3xl border border-slate-700 p-5"><h2 className="text-xl font-bold">{s.ready?'Record verified ledger changes':'Confirm opening balances'}</h2>
    <p className="text-sm">You must independently check the official account balances and transaction references. Do not enter passwords, PINs or OTPs.</p>
    <label className="block">Statement / transfer reference<input className={field} value={reference} onChange={e=>setReference(e.target.value)} minLength={5} maxLength={100} disabled={busy}/></label>
    <label className="block">Actual statement / transfer time<input className={field} type="datetime-local" step="1" value={at} onChange={e=>setAt(e.target.value)} disabled={busy}/></label>
    <button type="button" disabled={busy} className="text-sm underline" onClick={()=>setAt(localNow())}>Use current time after checking both accounts</button>
    <label className="flex items-start gap-3"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={busy}/><span>I independently checked these actual balances or completed transfers, their time and reference. This entry must not count a payment twice.</span></label>
    {!s.ready?<>
     <div className="grid gap-4 sm:grid-cols-2"><label>PalawanPay opening balance (PHP)<input className={field} type="number" min="0" step="0.01" value={palawan} onChange={e=>setPalawan(e.target.value)} disabled={busy}/></label><label>GoTyme opening balance (PHP)<input className={field} type="number" min="0" step="0.01" value={gotyme} onChange={e=>setGotyme(e.target.value)} disabled={busy}/></label></div>
     <p>Proposed combined cash: <strong>{php(Math.round(proposed))}</strong></p>
     <p className="text-sm">Existing member funds, reserved rewards and product receipts are excluded from new rewards funding. Maximum proposed allocation: <strong>{php(cap)}</strong>.</p>
     <label className="flex items-start gap-3"><input type="checkbox" checked={allocate} onChange={e=>setAllocate(e.target.checked)} disabled={busy || cap<10000}/><span>Also allocate up to {php(cap)} of uncommitted business cash to rewards. Existing funding rules may credit eligible queued registration bonuses and pending commissions. No cash leaves either account until an actual withdrawal is sent.</span></label>
     <button className={button} disabled={busy || !confirmed || reference.trim().length<5 || !at || !Number.isFinite(proposed) || Number(palawan)<0 || Number(gotyme)<0} onClick={()=>void submit('open')}>Confirm &amp; record opening balances</button>
    </>:<>
     <details className="rounded-xl border p-4"><summary className="cursor-pointer font-semibold">Fund rewards from uncommitted business cash</summary><p className="mt-3 text-sm">Available uncommitted cash: {php(s.unallocated)}. This excludes member funds and existing allocations. Daily Check-in, Gift Code, Tasks, commissions and tier rewards keep their existing budget protections.</p><label className="mt-3 block">Allocation amount (PHP)<input className={field} type="number" min="100" max={Number(s.unallocated)/100} step="0.01" value={fund} onChange={e=>setFund(e.target.value)}/></label><button className={button+' mt-4'} disabled={busy || !confirmed || reference.trim().length<5 || Number(fund)<100 || Number(fund)*100>Number(s.unallocated)} onClick={()=>void submit('fund')}>Record rewards allocation</button></details>
     <details className="rounded-xl border p-4"><summary className="cursor-pointer font-semibold">Reconcile an actual account balance</summary><label className="mt-3 block">Account<select className={field} value={account} onChange={e=>setAccount(e.target.value)}><option value="palawan">PalawanPay</option><option value="gotyme">GoTyme</option></select></label><label className="mt-3 block">Actual statement balance (PHP)<input className={field} type="number" min="0" step="0.01" value={balance} onChange={e=>setBalance(e.target.value)}/></label><button className={button+' mt-4'} disabled={busy || !confirmed || reference.trim().length<5 || !at || balance===''} onClick={()=>void submit('reconcile')}>Record reconciliation</button></details>
     <details className="rounded-xl border p-4"><summary className="cursor-pointer font-semibold">Record a completed transfer between accounts</summary><p className="mt-3 text-sm">Only after sending through the official bank app. This does not initiate a transfer.</p><label className="mt-3 block">From<select className={field} value={from} onChange={e=>setFrom(e.target.value)}><option value="palawan">PalawanPay → GoTyme</option><option value="gotyme">GoTyme → PalawanPay</option></select></label><label className="mt-3 block">Amount received by the other account (PHP)<input className={field} type="number" min="0.01" step="0.01" value={transferAmount} onChange={e=>setTransferAmount(e.target.value)}/></label><label className="mt-3 block">Sending fee (PHP)<input className={field} type="number" min="0" step="0.01" value={fee} onChange={e=>setFee(e.target.value)}/></label><button className={button+' mt-4'} disabled={busy || !confirmed || reference.trim().length<5 || !at || Number(transferAmount)<=0} onClick={()=>void submit('transfer')}>Record completed transfer</button></details>
    </>}
   </section>
   <section className="space-y-3"><h2 className="text-xl font-bold">Latest cash entries</h2>{!data?.entries.length&&<p>No cash movements have been recorded.</p>}{data?.entries.map(e=><article key={e.id} className="rounded-xl border border-slate-700 bg-slate-900 p-4"><p className="font-semibold">{name(e.account_id)} · {e.kind.replaceAll('_',' ')} · {php(e.delta)}</p><p className="mt-2 break-words text-sm">{e.reference} · {new Date(e.occurred_at).toLocaleString('en-PH')}</p><p className="mt-1 text-sm">Balance after: {php(e.balance_after)}</p></article>)}</section>
  </>}
 </div></main>;
}
