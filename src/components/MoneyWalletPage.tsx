'use client';
import { formatPhp } from '@/lib/format-php';
import Link from 'next/link';
import MemberVerification from '@/components/MemberVerification';
import { useCallback, useEffect, useRef, useState } from 'react';
import { moneyRequest } from '@/lib/money-client';
import { withdrawalFee } from '@/lib/withdrawal-fee';

type Transaction = { id:string; kind:string; amount:number; status:string; created_at:string };
type Destination = { id:string; method:string; account_name:string; account_number:string; verified:boolean };
type Verification={ id:string;kind:string;destination_id:string|null;status:string;expires_at:string|null };
type State = { manualPalawan?:boolean;manualGoTyme?:boolean;enabled:boolean;payoutsEnabled:boolean;withdrawalMode:string;ready:boolean;depositReady:boolean; wallet:{ available:number;deposit_available:number; reserved:number;held:number;debt:number }; customer:{ verified:boolean; blocked:boolean }|null; transactions:Transaction[]; destinations:Destination[];verifications:Verification[] };
const php = (cents:number) => formatPhp(Number(cents)/100);
const field = 'w-full rounded-xl border border-slate-700 bg-slate-900 p-3';
export default function MoneyPage() {
  const [data,setData] = useState<State|null>(null);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [busy,setBusy] = useState(false);
  const [amount,setAmount] = useState('300');
  const withdrawalAmount = Math.round(Number(amount) * 100);
  const fee = Number.isSafeInteger(withdrawalAmount) && withdrawalAmount > 0 ? withdrawalFee(withdrawalAmount) : 0;
  const [method,setMethod] = useState('gcash');
  const [destination,setDestination] = useState('');
  const [name,setName] = useState('');
  const [number,setNumber] = useState('');
  const pending = useRef<{ fingerprint:string; key:string }|null>(null);
  const locked = useRef(false);
  const refresh = useCallback(async () => {
    try { setData(await moneyRequest('/api/money')); }
    catch(e) { setError(e instanceof Error ? e.message : 'Unable to load Wallet'); }
  },[]);
  useEffect(() => { void refresh(); },[refresh]);
  async function submit(action:'deposit'|'withdrawal'|'destination') {
    if (locked.current) return;
    locked.current=true; setBusy(true); setError(''); setNotice('');
    try {
      const target = data?.destinations.find(d=>d.id===destination);
      const paymentMethod = action==='deposit' ? 'qrph' : action==='withdrawal' ? target?.method : method;
      const fingerprint = JSON.stringify({ action,amount,method:paymentMethod,destination });
      // Persist across refresh/network loss. Only rotate after a confirmed response.
      const saved = sessionStorage.getItem('unify-money-request');
      if (!pending.current && saved) pending.current=JSON.parse(saved);
      if (!pending.current || pending.current.fingerprint!==fingerprint) pending.current={ fingerprint,key:crypto.randomUUID() };
      sessionStorage.setItem('unify-money-request',JSON.stringify(pending.current));
      const result = await moneyRequest('/api/money',action==='destination'
          ? { action,method:paymentMethod,accountName:name,accountNumber:number }
        : { action,amount:Number(amount),method:paymentMethod,destinationId:destination,idempotencyKey:pending.current.key });
      if (action==='destination') { setName('');setNumber('');setNotice('Recipient saved for identity and ownership review.'); }
      else {
        setNotice(result.message ?? (action==='deposit' ? 'Checkout created. Open it from the transaction history. Your balance updates after payment verification.' : 'Amount deducted from available balance. Your withdrawal is pending administrator review.'));
        if (result.transaction?.checkout_url || action==='withdrawal') {
          pending.current=null; sessionStorage.removeItem('unify-money-request');
        }
      }
      await refresh();
    } catch(e) { setError(e instanceof Error ? e.message : 'Request could not be confirmed. Refresh before retrying.'); }
    finally { locked.current=false;setBusy(false); }
  }
  const eligible = (data?.manualGoTyme || data?.enabled) && data?.ready && data.customer?.verified && !data.customer.blocked;
  return <main className="min-h-screen bg-slate-950 p-6 text-white"><div className="mx-auto max-w-3xl space-y-6">
    <header><Link href="/dashboard" className="text-blue-300">← Dashboard</Link><h1 className="mt-4 text-3xl font-bold">Wallet</h1><p className="mt-2 text-slate-400">Deposits and withdrawals are credited after verified review.</p></header>
    {error && <p role="alert" className="rounded-xl bg-red-950 p-4 text-red-200">{error}</p>}
    {notice && <p role="status" className="rounded-xl bg-blue-950 p-4">{notice}</p>}
    {!data ? <p>Loading wallet…</p> : <>
      <section className="grid grid-cols-2 gap-4 rounded-xl bg-slate-900 p-5"><div><p>Available</p><strong className="text-2xl">{php(data.wallet.available)}</strong></div><div><p>Pending withdrawals and adjustments</p><strong className="text-2xl">{php(data.wallet.reserved)}</strong></div></section>
      <section className="rounded-xl bg-slate-900 p-5"><p>Deposit Balance</p><strong className="text-2xl">{php(data.wallet.deposit_available)}</strong><p className="mt-2 text-sm text-slate-300">For product purchases only · Not withdrawable</p></section>
      <section className="grid grid-cols-2 gap-4 rounded-xl bg-slate-900 p-5"><div><p>Held for settlement</p><strong className="text-2xl">{php(data.wallet.held)}</strong></div><div><p>Outstanding reversal shortfall</p><strong className="text-2xl">{php(data.wallet.debt)}</strong></div><p className="col-span-2 text-sm text-slate-400">Paid deposits stay held until settlement review. Pending amounts are deducted from available balance and cannot be spent again. They include withdrawals, refunds, and disputes. Shortfalls restrict withdrawals.</p></section>
      <MemberVerification reviews={data.verifications} recipients={data.destinations} onRefresh={refresh}/>
      <p className="text-amber-200">Automated deposits and transfers are unavailable. Use only a separately approved manual process; account balances shown here are ledger records.</p>
      <section className="space-y-4 rounded-xl border border-slate-700 p-5"><h2 className="text-xl font-semibold">Deposit or withdraw</h2>
        <label className="block">Amount (PHP)<input className={field} type="number" min="60" max="50000" step="0.01" value={amount} disabled={busy} onChange={e=>setAmount(e.target.value)}/></label>
        <p className="text-sm text-slate-400">Deposits: ₱300–₱50,000. Withdrawals: ₱60–₱50,000. Daily limit: ₱100,000 per type.</p>
        <p className="rounded-xl border border-amber-800 bg-amber-950 p-3 text-amber-100">Deposits are paused. No checkout or automatic payment confirmation is available.</p>
        <label className="block">Verified withdrawal recipient<select className={field} value={destination} disabled={busy} onChange={e=>setDestination(e.target.value)}><option value="">Choose recipient</option>{data.destinations.filter(d=>['gcash','maya'].includes(d.method) && d.verified && data.verifications.some(v=>v.destination_id===d.id && v.status==='approved' && v.expires_at && Date.parse(v.expires_at)>Date.now())).map(d=><option key={d.id} value={d.id}>{d.method.toUpperCase()} · {d.account_name} · ****{d.account_number.slice(-4)}</option>)}</select></label>
        {fee > 0 && <p className="text-sm">Withdrawal amount {php(withdrawalAmount)} · 5% withdrawal fee {php(fee)} · You receive <strong>{php(withdrawalAmount-fee)}</strong></p>}
        <p className="text-sm text-amber-200">Admin Approval only. A request does not mean a transfer was sent or completed.</p>
        <button className="rounded-xl bg-emerald-700 px-5 py-3 disabled:opacity-40" disabled={busy || !eligible || !data.manualGoTyme || !destination} onClick={()=>void submit('withdrawal')}>Request manual withdrawal</button>
      </section>
      <form className="space-y-4 rounded-xl border border-slate-700 p-5" onSubmit={e=>{e.preventDefault();void submit('destination');}}><h2 className="text-xl font-semibold">Add withdrawal recipient</h2><p className="text-sm text-slate-400">Select the receiving wallet. A review must verify your ownership before withdrawals.</p>
        <label className="block">Receiving wallet<select className={field} value={method} disabled={busy} onChange={e=>setMethod(e.target.value)}><option value="gcash">GCash</option><option value="maya">Maya</option></select></label>
        <label className="block">Registered full name<input className={field} value={name} maxLength={100} required disabled={busy} onChange={e=>setName(e.target.value)}/></label>
        <label className="block">Mobile number<input className={field} value={number} pattern="09[0-9]{9}" placeholder="09XXXXXXXXX" required disabled={busy} onChange={e=>setNumber(e.target.value)}/></label>
        <button disabled={busy} className="rounded-xl bg-slate-700 px-5 py-3">Submit recipient for review</button>
        {data.destinations.map(d=><div key={d.id} className="text-sm"><p>{d.method.toUpperCase()} · ****{d.account_number.slice(-4)} · {d.verified ? 'Verified' : 'Awaiting ownership verification'}</p><a className="text-blue-300" href="#verification">Request ownership verification above</a></div>)}
      </form>
      <section className="space-y-3"><div className="flex justify-between"><h2 className="text-xl font-semibold">Recent PHP transactions</h2><button disabled={busy} onClick={()=>void refresh()} className="text-blue-300">Refresh status</button></div>
        <p className="text-sm text-slate-400">A receipt alone does not confirm payment. Your deposit remains pending until payment is independently verified. Contact support for disputed payments.</p>
        {data.transactions.length===0 && <p>No PHP transactions yet.</p>}
        {data.transactions.map(t=><article key={t.id} className="rounded-xl bg-slate-900 p-4"><p>{t.kind.replaceAll('_',' ')} · {php(t.amount)} · <strong>{t.kind==='withdrawal' && t.status==='reserved' ? 'pending approval' : t.status}</strong></p><p className="break-all text-xs text-slate-400">{t.id} · {new Date(t.created_at).toLocaleString()}</p>{['creating','processing'].includes(t.status) && <p className="mt-2 text-sm text-amber-200">If status is delayed, contact support with this reference. Do not create another payment for the same request.</p>}</article>)}
      </section>
    </>}
  </div></main>;
}
