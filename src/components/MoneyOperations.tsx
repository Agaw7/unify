'use client';
import { formatPhp } from '@/lib/format-php';
import { useCallback, useEffect, useRef, useState } from 'react';
import { moneyRequest } from '@/lib/money-client';

type Verification={ id:string; user_id:string; destination_id:string|null; kind:string; status:string; provider:string|null; expires_at:string|null;evidence_reference:string|null;reviewed_by:string|null;updated_at:string };
type Hold={ transaction_id:string;remaining:number;money_transactions:{ user_id:string;amount:number;payment_id:string|null } };
type Adjustment={ id:string;transaction_id:string;kind:string;amount:number;status:string;provider_reference:string|null;shortfall:number };
type Alert={ key:string;transaction_id:string|null;severity:string;message:string };
type State={ reviewEnabled:boolean;verifications:Verification[];holds:Hold[];adjustments:Adjustment[];alerts:Alert[] };
const input='w-full rounded-lg border border-slate-600 bg-slate-900 p-3';
const button='rounded-lg bg-slate-700 px-4 py-2 disabled:opacity-40';
export default function MoneyOperations({ settlementOnly = false }: { settlementOnly?: boolean }) {
  const [data,setData]=useState<State|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  const [reason,setReason]=useState(''),[id,setId]=useState(''),[reference,setReference]=useState(''),[amount,setAmount]=useState('');
  const [verification,setVerification]=useState(''),[status,setStatus]=useState('approved'),[provider,setProvider]=useState(''),[expires,setExpires]=useState(''),[bic,setBic]=useState('');
  const [evidenceChecked,setEvidenceChecked]=useState(false);
  const selectedReview=data?.verifications.find(v=>v.id===verification);
  const lock=useRef(false),refundKey=useRef<{ fingerprint:string;key:string }|null>(null);
  const refresh=useCallback(async()=>{
    try { setData(await moneyRequest(settlementOnly ? '/api/admin/money/operations?view=deposit-settlement' : '/api/admin/money/operations')); }
    catch(e) { setError(e instanceof Error ? e.message : 'Unable to load operations'); }
  },[settlementOnly]);
  useEffect(()=>{void refresh();},[refresh]);
  async function act(body:Record<string,unknown>) {
    if(lock.current) return;
    lock.current=true;setBusy(true);setMessage('');setError('');
    try {
      const result=await moneyRequest('/api/admin/money/operations',{ reason,...body });
      setMessage(body.action==='reconcile' ? `Reconciliation: ${result.checked ?? 0} checked, ${result.issues ?? 0} issues${result.skipped ? ' (another worker is active)' : ''}.` : 'Operation confirmed.');
      await refresh();
    } catch(e) { setError(e instanceof Error ? e.message : 'Operation needs reconciliation'); }
    finally { lock.current=false;setBusy(false); }
  }
  function requestRefund() {
    const value=Number(amount),cents=Math.round(value*100);
    if(!Number.isFinite(value) || Math.abs(value*100-cents)>0.000001 || cents<100) { setError('Enter a refund amount of at least ₱1 with at most two decimal places.');return; }
    const fingerprint=`${id}:${cents}`;
    // A fixed payload retains its idempotency key across network failures and refreshes.
    try {
      const stored=sessionStorage.getItem('unify-refund-request');
      if(!refundKey.current && stored) refundKey.current=JSON.parse(stored);
      if(refundKey.current?.fingerprint!==fingerprint) refundKey.current={ fingerprint,key:crypto.randomUUID() };
      sessionStorage.setItem('unify-refund-request',JSON.stringify(refundKey.current));
      void act({ action:'refund_request',id,amount:cents,key:refundKey.current!.key });
    } catch { setError('Browser storage unavailable. Enable session storage before requesting a refund.'); }
  }
  if(settlementOnly) return <section id="deposit-approval" className="space-y-4 rounded-xl border border-slate-700 p-5">
    <h2 className="text-2xl">Deposit approval</h2>
    <p className="text-sm text-amber-200">Check the approved receiving-account settlement record before approving. Only another administrator can approve your own deposit.</p>
    {error && <p role="alert" className="text-red-300">{error}</p>}
    {message && <p role="status" className="text-green-300">{message}</p>}
    <button className={button} disabled={busy} onClick={()=>void refresh()}>Refresh deposits</button>
    {data && (data.holds.length===0 ? <p>No deposits held for settlement.</p> : <>
      <label className="block">Settlement report reference<textarea className={input} value={reason} maxLength={500} onChange={e=>setReason(e.target.value)}/></label>
      {data.holds.map(h=><article className="space-y-2 rounded-lg bg-slate-900 p-3" key={h.transaction_id}>
        <p>{formatPhp((Number(h.remaining)/100))} held</p>
        <p className="break-all text-sm">Deposit: {h.transaction_id}<br/>Customer: {h.money_transactions.user_id}<br/>External payment reference: {h.money_transactions.payment_id ?? 'Not linked'}</p>
        <button className={button} disabled={busy || reason.trim().length<5 || !h.money_transactions.payment_id} onClick={()=>{
          if(window.confirm('Approve this deposit using the settlement report you verified?')) void act({ action:'release',id:h.transaction_id });
        }}>Approve deposit</button>
      </article>)}
    </>)}
  </section>;
  return <section className="space-y-5 rounded-xl border border-slate-700 p-5"><h2 className="text-2xl">Verification and reversals</h2>
    <p className="text-sm text-amber-200">Manual reviews use evidence received through your established secure support channel. Check identity and recipient ownership before approval.</p>
    {error && <p role="alert" className="text-red-300">{error}</p>}{message && <p role="status" className="text-green-300">{message}</p>}
    <div className="flex gap-3"><button className={button} disabled={busy} onClick={()=>void refresh()}>Refresh operations</button><button className={button} disabled={busy} onClick={()=>void act({ action:'reconcile' })}>Run reconciliation now</button></div>
    <label className="block">Evidence / case reference<textarea className={input} value={reason} maxLength={500} onChange={e=>setReason(e.target.value)}/></label>
    {data && <>
      <div className="space-y-3"><h3 className="text-xl">Verification reviews</h3>
        <p className="text-sm text-amber-200">{data.reviewEnabled ? 'Manual review enabled. Another administrator must review your own account.' : 'Manual review is disabled. Configure VERIFICATION_REVIEW_ENABLED=true after adopting the documented review process.'}</p>
        {data.verifications.length===0 && <p>No member review requests yet.</p>}
        <label className="block">Review request<select className={input} value={verification} onChange={e=>{setVerification(e.target.value);setEvidenceChecked(false);setReason('');}}><option value="">Select request</option>{data.verifications.map(v=><option key={v.id} value={v.id}>{v.kind} · {v.status} · {v.user_id} · {v.destination_id ?? 'customer'}</option>)}</select></label>
        {selectedReview && <article className="space-y-2 rounded-lg bg-slate-900 p-4 text-sm"><p>{selectedReview.kind} · {selectedReview.status}</p><p className="break-all">Customer: {selectedReview.user_id}</p><p className="break-all">Recipient: {selectedReview.destination_id ?? 'Account identity'}</p><p className="break-words">Submitted case / previous decision: {selectedReview.evidence_reference ?? 'No case reference supplied — request evidence before approval'}</p></article>}
        <label className="block">Approved verification provider / process<input className={input} placeholder="AROMEVA manual review v1" maxLength={100} value={provider} onChange={e=>setProvider(e.target.value)}/></label>
        <label className="block">Decision<select className={input} value={status} onChange={e=>setStatus(e.target.value)}><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="expired">Expired / revoked</option></select></label>
        <label className="block">Expiry (maximum one year)<input className={input} type="datetime-local" value={expires} onChange={e=>setExpires(e.target.value)}/></label>
        <label className="block">Verified institution BIC (ownership approval)<input className={input} value={bic} onChange={e=>setBic(e.target.value)}/></label>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={evidenceChecked} onChange={e=>setEvidenceChecked(e.target.checked)}/><span>I checked the actual case evidence and, for recipient reviews, matched the wallet owner and receiving institution. A case reference alone is insufficient.</span></label>
        <p className="text-sm text-slate-300">The review reason above is visible to the member. Include a useful result and case reference; do not copy identity documents or private ID numbers.</p>
        <button className={button} disabled={busy || !data.reviewEnabled || !verification || !expires || provider.trim().length<2 || reason.trim().length<5 || (status==='approved' && (!evidenceChecked || !selectedReview || !['submitted','pending'].includes(selectedReview.status)))} onClick={()=>void act({ action:'verification',id:verification,status,provider,expires:new Date(expires).toISOString(),bic:bic || null,evidenceChecked })}>Record verification decision</button>
        <div className="space-y-2"><h4 className="font-semibold">Recent review history</h4>{data.verifications.filter(v=>!['submitted','pending'].includes(v.status)).map(v=><article key={v.id} className="break-words rounded-lg bg-slate-900 p-3 text-sm"><p>{v.kind} · {v.status} · {new Date(v.updated_at).toLocaleString()}</p><p className="break-all">Customer: {v.user_id} · Reviewer: {v.reviewed_by ?? 'Unavailable'}</p><p>{v.evidence_reference}</p></article>)}</div>
      </div>
      <div className="space-y-3"><h3 className="text-xl">Request a full or partial refund</h3>
        <label className="block">Original deposit UUID<input className={input} value={id} onChange={e=>setId(e.target.value)}/></label>
        <label className="block">Refund amount (PHP)<input className={input} type="number" min="1" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
        <button className={button} disabled={busy || !id || reason.length<5} onClick={requestRefund}>Reserve refund for independent approval</button>
        <label className="block">Provider refund ID to reconcile / recover<input className={input} value={reference} onChange={e=>setReference(e.target.value)} placeholder="ref_…"/></label>
        <button className={button} disabled={busy || !reference} onClick={()=>void act({ action:'refund_verify',reference })}>Retrieve and verify refund</button>
        {data.adjustments.map(a=><article className="rounded-lg bg-slate-900 p-3" key={a.id}><p>{a.kind} · {formatPhp((Number(a.amount)/100))} · {a.status}</p><p className="break-all text-sm">Case: {a.id}<br/>Deposit: {a.transaction_id}<br/>Provider: {a.provider_reference ?? 'Not linked'}<br/>Original shortfall: {formatPhp((Number(a.shortfall)/100))}</p>{a.kind==='refund' && a.status==='requested' && <div className="flex gap-3"><button className={button} disabled={busy || reason.length<5} onClick={()=>{if(window.confirm('Send this real-money refund to its original payment method?')) void act({ action:'refund_send',id:a.id });}}>Send refund (second administrator)</button><button className={button} disabled={busy || reason.length<5} onClick={()=>void act({ action:'refund_cancel',id:a.id })}>Cancel unsubmitted refund</button></div>}</article>)}
      </div>
      <div className="space-y-3"><h3 className="text-xl">Unresolved operations alerts</h3><p className="text-sm text-slate-400">Critical alerts restrict affected customers; unmatched events restrict all financial processing until investigated. Acknowledgment does not erase debt or release disputed funds.</p>{data.alerts.map(a=><article className="rounded-lg border border-amber-700 p-3" key={a.key}><p>{a.severity}: {a.message}</p><p className="break-all text-sm">{a.key} · {a.transaction_id ?? 'Unmatched event'}</p><button className={button} disabled={busy || reason.length<5} onClick={()=>{if(window.confirm('Acknowledge this alert only after investigating and recording evidence.')) void act({ action:'alert_resolve',key:a.key });}}>Resolve with evidence</button></article>)}</div>
    </>}
  </section>;
}
