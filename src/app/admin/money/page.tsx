'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { moneyRequest } from '@/lib/money-client';
import MoneyOperations from '@/components/MoneyOperations';
import MoneyReadiness from '@/components/MoneyReadiness';
import LiveWithdrawalSettings from '@/components/LiveWithdrawalSettings';
import ManualQrDepositReview from '@/components/ManualQrDepositReview';
import { withdrawalPayout } from '@/lib/withdrawal-fee';

type Transaction = { id:string; user_id:string; kind:string; method:string; amount:number; withdrawal_fee?:number; status:string; withdrawal_mode?:string; provider_reference:string|null; created_at:string; destination_snapshot:{ name:string; number:string; bic:string }|null };
type Destination = { id:string; user_id:string; method:string; account_name:string; account_number:string; verified:boolean };
type Customer = { user_id:string; verified:boolean; blocked:boolean };
type Audit = { id:number; action:string; actor_id:string|null; subject_id:string|null; created_at:string; details:unknown };
type Data = { transactions:Transaction[]; destinations:Destination[]; customers:Customer[]; audit:Audit[]; manualGoTyme?:boolean; manualQrPayout?: boolean;treasuryEnabled?:boolean };
const field='w-full rounded-lg border border-slate-600 bg-slate-900 p-3';
export default function AdminMoneyPage() {
  const [data,setData]=useState<Data|null>(null);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const [userId,setUserId]=useState('');
  const [destinationId,setDestinationId]=useState('');
  const [bic,setBic]=useState('');
  const [verified,setVerified]=useState(false);
  const [blocked,setBlocked]=useState(false);
  const [reason,setReason]=useState('');
  const [reference,setReference]=useState('');
  const [sentAt,setSentAt]=useState('');
  const [sendingFee,setSendingFee]=useState('0');
  const refresh=useCallback(async()=>{
    try { setData(await moneyRequest('/api/admin/money')); }
    catch(e) { setError(e instanceof Error ? e.message : 'Unable to load money administration'); }
  },[]);
  useEffect(()=>{void refresh();},[refresh]);
  async function act(body:unknown) {
    setBusy(true);setError('');setNotice('');
    try { await moneyRequest('/api/admin/money',body);setNotice('Operation confirmed.');await refresh(); }
    catch(e) { setError(e instanceof Error ? e.message : 'Operation needs review');await refresh(); }
    finally { setBusy(false); }
  }
  return <main className="min-h-screen bg-slate-950 p-6 text-white"><div className="mx-auto max-w-5xl space-y-6">
    <Link href="/admin" className="text-blue-300">← Administration</Link><h1 className="text-3xl font-bold">PHP payment operations</h1>
    <Link href="/admin/gift-codes" className="block font-semibold text-cyan-300">Manage gift codes</Link>
    <Link href="/admin/business-budget" className="inline-block rounded-lg bg-cyan-400 px-4 py-3 font-semibold text-slate-950">View recorded Business Rewards Budget</Link>
    {data && !data.manualGoTyme && <MoneyReadiness />}
    {data?.manualGoTyme && <p className="rounded-xl border p-4">Manual PalawanPay deposits · Manual GCash / Maya withdrawals · Gateway transfers disabled. Verify all receipts and transfer results in the official receiving/sending account.</p>}
    <MoneyOperations settlementOnly />
    <p className="text-slate-400">Administrator access is required for these operations. Withdrawal approval and payout submission require different administrators. Review identity evidence, recipient ownership, unusual volumes, and transaction references before approval.</p>
    {error && <p role="alert" className="rounded-lg bg-red-950 p-4">{error}</p>}{notice && <p role="status">{notice}</p>}
    <button disabled={busy} className="text-blue-300" onClick={()=>void refresh()}>Refresh records</button>
    {data && <>
      <LiveWithdrawalSettings/>
      <MoneyOperations/>
      <section className="space-y-4 rounded-xl border border-slate-700 p-5"><h2 className="text-xl">Identity, recipient, and restriction review</h2>
        <p className="text-sm text-amber-200">Verify evidence through your approved identity / ownership process. A saved recipient is not verified automatically. Confirm the receiving institution BIC with the bank.</p>
        <label className="block">Customer UUID<input className={field} value={userId} onChange={e=>setUserId(e.target.value)}/></label>
        <label className="block">Recipient UUID (leave blank to review customer)<input className={field} value={destinationId} onChange={e=>setDestinationId(e.target.value)}/></label>
        <label className="block">Institution BIC (recipient verification only)<input className={field} value={bic} onChange={e=>setBic(e.target.value)}/></label>
        <label className="mr-5 inline-flex gap-2"><input type="checkbox" checked={verified} onChange={e=>setVerified(e.target.checked)}/>Verified</label>
        <label className="inline-flex gap-2"><input type="checkbox" checked={blocked} onChange={e=>setBlocked(e.target.checked)}/>Restrict customer (customer review only)</label>
        <label className="block">Evidence reference / review reason<textarea className={field} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Internal case or evidence reference; do not paste identity documents"/></label>
        <button disabled={busy || !userId || reason.trim().length<5} className="rounded-lg bg-blue-700 p-3 disabled:opacity-40" onClick={()=>void act({ action:'compliance',userId,destinationId:destinationId || null,bic:bic || null,verified,blocked,reason })}>Record compliance review</button>
        {data.customers.map(c=><p key={c.user_id} className="break-all text-sm">{c.user_id} · {c.verified ? 'verified' : 'unverified'} · {c.blocked ? 'restricted' : 'unrestricted'}</p>)}
        <h3 className="font-semibold">Recent recipient submissions</h3>
        {data.destinations.map(d=><div key={d.id} className="rounded-lg bg-slate-900 p-3 text-sm"><p>{d.method.toUpperCase()} · {d.account_name} · ****{d.account_number.slice(-4)} · {d.verified ? 'verified' : 'pending verification'}</p><p className="break-all">Customer: {d.user_id}<br/>Recipient: {d.id}</p><button className="text-blue-300" onClick={()=>{setUserId(d.user_id);setDestinationId(d.id);setVerified(false);setBic('');setReason('');}}>Select recipient</button></div>)}
      </section>
      <section className="space-y-4"><h2 className="text-xl">Latest 200 transactions</h2>
        <label className="block">{data.manualGoTyme?'Actual GoTyme transfer reference (required when recording a result)':'External transaction reference'}<input className={field} value={reference} onChange={e=>setReference(e.target.value)} placeholder={data.manualGoTyme?'Reference from GoTyme history':'External reference'}/></label>
        <p className="text-sm text-amber-200">Use the review reason above for approvals and rejections. Verify the amount, reference, and recipient directly in the official account history. Processing requests must never be resubmitted.</p>
        {data.transactions.map(t=><article key={t.id} className="space-y-2 rounded-xl border border-slate-700 p-4">
          <p className="text-sm text-cyan-200">{t.kind==='withdrawal' ? (t.withdrawal_mode==='automatic'?'Automatic Withdrawal':'Admin Approval') : ''}</p><p className="text-lg">{t.kind} · ₱{(Number(t.amount)/100).toFixed(2)} · <strong>{t.status}</strong></p>
          <p className="break-all text-sm text-slate-400">{t.id}<br/>Customer: {t.user_id}<br/>External reference: {t.provider_reference ?? 'Not linked'}<br/>{new Date(t.created_at).toLocaleString()}</p>
          {t.destination_snapshot && <p className="break-all text-sm">Recipient: {t.destination_snapshot.name} · {t.destination_snapshot.number} · {t.destination_snapshot.bic}</p>}
          {t.kind==='withdrawal' && <p className="text-sm">Withdrawal fee ₱{(Number(t.withdrawal_fee ?? 0)/100).toFixed(2)} · Send ₱{(withdrawalPayout(t)/100).toFixed(2)}</p>}
          {t.status==='pending' && t.provider_reference?.startsWith('manual-qrph:') &&
            <ManualQrDepositReview id={t.id} onVerified={() => void refresh()} />}
          <p className="text-sm text-amber-200">{Number(t.amount)>=1000000 ? 'Review: large transaction (₱10,000+). ' : ''}{['creating','processing'].includes(t.status) && Date.now()-Date.parse(t.created_at)>20*60*1000 ? 'Review: confirmation delayed.' : ''}</p>
          <div className="flex flex-wrap gap-4">
            {t.status==='reserved' && <button disabled={busy || reason.trim().length<5} className="text-emerald-300 disabled:opacity-40" onClick={()=>void act({ action:'approve',id:t.id,reason })}>Approve</button>}
            {['reserved','approved'].includes(t.status) && <button disabled={busy || reason.trim().length<5} className="text-red-300 disabled:opacity-40" onClick={()=>void act({ action:'reject',id:t.id,reason })}>Reject and release funds</button>}
            {t.kind==='withdrawal' && t.status==='approved' && data.manualGoTyme && <button disabled={busy} onClick={()=>void act({action:'claim_manual_gotyme',id:t.id})}>Start manual {data.treasuryEnabled?'GoTyme payout':t.method.toUpperCase()+' transfer'}</button>}
          </div>
          {data.manualGoTyme && t.kind==='withdrawal' && t.status==='processing' && (!t.provider_reference || t.provider_reference.startsWith('manual-')) && <div className="space-y-2">{data.treasuryEnabled && <div className="space-y-3"><label className="block">Actual GoTyme transfer time<input className={field} type="datetime-local" value={sentAt} onChange={e=>setSentAt(e.target.value)}/></label><label className="block">Actual GoTyme sending fee (PHP)<input className={field} type="number" min="0" max="1000" step="0.01" value={sendingFee} onChange={e=>setSendingFee(e.target.value)}/></label></div>}<p>Send only once using the recipient and net amount above. Verify the result in your {data.treasuryEnabled?'GoTyme sender':t.method.toUpperCase()} transaction history.</p>{(['succeeded','failed'] as const).map(status=><button key={status} disabled={busy || reference.trim().length<5 || (status==='succeeded' && data.treasuryEnabled && !sentAt)} className="mr-4 text-cyan-200" onClick={()=>{if(window.confirm(status==='succeeded'?'Confirm the manual transfer succeeded and the reference matches this recipient and net amount.':'Confirm no funds reached the recipient. An unknown result must remain processing.'))void act({action:'record_manual_gotyme',id:t.id,status,reference:reference.trim().toUpperCase(),confirm:true,sentAt:sentAt?new Date(sentAt).toISOString():undefined,sendingFee:Number(sendingFee)});}}>{status==='succeeded'?'Record successful transfer':'Record confirmed failed transfer'}</button>)}</div>}
        </article>)}
      </section>
      <section className="space-y-3"><h2 className="text-xl">Latest 100 audit records</h2>{data.audit.map(a=><article key={a.id} className="break-all rounded-lg bg-slate-900 p-3 text-sm"><p>{a.action} · {new Date(a.created_at).toLocaleString()}</p><p>Actor: {a.actor_id ?? 'Provider / system'} · Subject: {a.subject_id}</p><pre className="whitespace-pre-wrap">{JSON.stringify(a.details)}</pre></article>)}</section>
    </>}
  </div></main>;
}
