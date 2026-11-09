'use client';
import { useRef, useState } from 'react';
import { moneyRequest } from '@/lib/money-client';

export type MemberReview={id:string;kind:string;destination_id:string|null;status:string;expires_at:string|null;evidence_reference?:string|null;updated_at?:string};
type Recipient={id:string;method:string;account_number:string};
export default function MemberVerification({reviews,recipients,onRefresh}:{reviews:MemberReview[];recipients:Recipient[];onRefresh:()=>Promise<void>}) {
  const [kind,setKind]=useState('identity'),[destination,setDestination]=useState(''),[reference,setReference]=useState(''),[confirmed,setConfirmed]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const lock=useRef(false);
  const active=reviews.some(v=>v.kind===kind && v.destination_id===(kind==='ownership'?destination:null) && (['submitted','pending'].includes(v.status) || (v.status==='approved' && !!v.expires_at && Date.parse(v.expires_at)>Date.now())));
  async function submit(event:React.FormEvent) {
    event.preventDefault();if(lock.current)return;
    lock.current=true;setBusy(true);setError('');setNotice('');
    try {
      const result=await moneyRequest('/api/money/verification',{kind,destinationId:kind==='ownership'?destination:undefined,evidenceReference:reference.trim(),confirmed});
      setNotice(result.message ?? 'A review already exists. Check its status below.');setReference('');setConfirmed(false);await onRefresh();
    } catch(e){setError(e instanceof Error?e.message:'Unable to submit review');}
    finally{lock.current=false;setBusy(false);}
  }
  const field='mt-1 w-full min-w-0 rounded-lg border border-slate-600 bg-slate-900 p-3 text-white';
  return <section id="verification" className="space-y-4 rounded-xl border border-slate-700 p-5">
    <h2 className="text-xl font-semibold">Withdrawal identity and recipient verification</h2>
    <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-300"><li>Contact AUREVIA support through your established secure channel to arrange manual review.</li><li>Provide the requested identity or wallet ownership evidence through that channel and obtain a case reference.</li><li>Submit that reference below. An independent administrator checks the evidence before deciding.</li></ol>
    <p className="text-sm text-amber-200">Do not enter ID numbers, passwords, OTPs, document links, or upload identity documents here. A case reference alone does not verify your account.</p>
    {error && <p role="alert" className="text-red-200">{error}</p>}{notice && <p role="status" className="text-cyan-200">{notice}</p>}
    <form onSubmit={e=>void submit(e)} className="space-y-4">
      <label className="block">Review type<select className={field} value={kind} disabled={busy} onChange={e=>setKind(e.target.value)}><option value="identity">Account identity — required for withdrawals</option><option value="ownership">Recipient account ownership — required for withdrawals</option></select></label>
      {kind==='ownership' && <label className="block">Recipient<select className={field} value={destination} required disabled={busy} onChange={e=>setDestination(e.target.value)}><option value="">Choose your saved recipient</option>{recipients.filter(d=>['gcash','maya'].includes(d.method)).map(d=><option key={d.id} value={d.id}>{d.method.toUpperCase()} · ****{d.account_number.slice(-4)}</option>)}</select>{recipients.length===0 && <span className="text-sm text-amber-200">Add a recipient below first.</span>}</label>}
      <label className="block">Secure review case reference<input className={field} value={reference} onChange={e=>setReference(e.target.value)} minLength={5} maxLength={120} placeholder="Case reference provided by support" required disabled={busy}/></label>
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" required checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/><span>I provided accurate evidence for this case. For a recipient review, I own the selected wallet. I understand that approval is required.</span></label>
      <button className="rounded-lg bg-cyan-400 px-4 py-3 font-semibold text-slate-950 disabled:opacity-40" disabled={busy || active || !confirmed || (kind==='ownership' && !destination)}>{busy?'Submitting…':active?'Review already active':'Submit for manual review'}</button>
    </form>
    <div className="space-y-3"><h3 className="font-semibold">Review history</h3>{reviews.length===0 && <p className="text-sm text-slate-300">No verification requests yet.</p>}{reviews.map(v=><article className="space-y-1 rounded-lg bg-slate-900 p-3 text-sm" key={v.id}><p className="font-semibold">{v.kind==='identity'?'Account identity':'Recipient ownership'} · {v.status==='approved' && v.expires_at && Date.parse(v.expires_at)<=Date.now()?'expired':v.status}</p><p className="break-all text-slate-300">Request: {v.id}</p>{v.evidence_reference && <p className="break-words text-slate-300">{['submitted','pending'].includes(v.status)?'Submitted case':'Review result / reference'}: {v.evidence_reference}</p>}{v.expires_at && <p>Expiry: {new Date(v.expires_at).toLocaleString()}</p>}{v.status==='rejected' && <p className="text-amber-200">Contact support about the review result before submitting a new case.</p>}</article>)}</div>
  </section>;
}
