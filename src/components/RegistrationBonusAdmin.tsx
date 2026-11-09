'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { moneyRequest } from '@/lib/money-client';

const bonusAmount = (amount: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(amount / 100);

type Bonus = { user_id:string;phone_last4:string|null;amount:number;revoked_at:string|null;reclaim_reason:string|null;has_deposit:boolean;has_identity:boolean;unspent:boolean;can_reclaim:boolean };
export default function RegistrationBonusAdmin({ onChanged }: { onChanged:()=>Promise<void> }) {
  const [bonuses,setBonuses]=useState<Bonus[]|null>(null),[reason,setReason]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const lock=useRef(false);
  const load=useCallback(async()=>{
    try { const result=await moneyRequest('/api/admin/registration-bonuses');setBonuses(result.bonuses); }
    catch(failure){setError(failure instanceof Error?failure.message:'Unable to load registration bonuses.');}
  },[]);
  useEffect(()=>{void load();},[load]);
  async function reclaim(bonus:Bonus){
    if(lock.current || !bonus.can_reclaim || !window.confirm(`Reclaim the unspent ${bonusAmount(bonus.amount)} registration bonus from ****${bonus.phone_last4 ?? '????'} and return it to the business budget?`))return;
    lock.current=true;setBusy(true);setError('');setNotice('');
    try{
      await moneyRequest('/api/admin/registration-bonuses',{userId:bonus.user_id,key:crypto.randomUUID(),reason});
      setNotice('Registration bonus returned to the business rewards budget.');setReason('');
      await load();await onChanged();
    }catch(failure){setError(failure instanceof Error?failure.message:'Unable to confirm bonus reclaim.');await load();}
    finally{lock.current=false;setBusy(false);}
  }
  return <section className="space-y-3 rounded-xl border border-slate-700 p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl">Registration bonuses</h2><button type="button" disabled={busy} className="text-cyan-300" onClick={()=>void load()}>Refresh bonuses</button></div>
    <p className="text-sm text-slate-300">New registrations receive ₱20 automatically from funded business rewards. Reclaim is allowed only with no completed deposit, no identity approval on record, and a provably unspent bonus. Earned funds and deposits are protected.</p>
    {error && <p role="alert" className="text-red-200">{error}</p>}{notice && <p role="status" className="text-cyan-200">{notice}</p>}
    <label className="block">Reclaim reason<textarea disabled={busy} minLength={5} maxLength={300} value={reason} onChange={event=>setReason(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 p-3 text-white"/></label>
    {bonuses===null?<p>Loading bonuses…</p>:bonuses.length===0?<p>No funded registration bonuses yet.</p>:bonuses.map(bonus=><article key={bonus.user_id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-900 p-4">
      <div className="min-w-0"><p>****{bonus.phone_last4 ?? '????'} · {bonusAmount(bonus.amount)}</p><p className="text-sm text-slate-300">{bonus.revoked_at?'Reclaimed':bonus.has_deposit || bonus.has_identity?'Protected: completed deposit or identity approval':bonus.unspent?'Unspent; eligible for admin reclaim':'Financial activity requires review'}</p>{bonus.reclaim_reason && <p className="break-words text-sm text-slate-300">{bonus.reclaim_reason}</p>}</div>
      <button type="button" disabled={busy || !bonus.can_reclaim || reason.trim().length<5} className="rounded-lg bg-red-700 px-4 py-3 font-semibold disabled:opacity-40" onClick={()=>void reclaim(bonus)}>Reclaim {bonusAmount(bonus.amount)} bonus</button>
    </article>)}
  </section>;
}
