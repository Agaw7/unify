'use client';

import Link from 'next/link';
import { ArrowLeft, RefreshCw, Save, CheckCircle2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import MemberVerification from '@/components/MemberVerification';
import { moneyRequest } from '@/lib/money-client';
import { withdrawalFee } from '@/lib/withdrawal-fee';
import styles from './manual-withdrawal.module.css';

type Recipient = { id:string; method:string; account_name:string; account_number:string; verified:boolean };
type LegacyRecipient = {id:string;provider:string;account_name:string;account_number:string};
type Review = { id:string; kind:string; destination_id:string|null; status:string; expires_at:string|null };
type Entry = { id:string; kind:string; amount:number; status:string; created_at:string; withdrawal_fee?:number };
type Wallet = {
  manualGoTyme?:boolean; enabled:boolean; payoutsEnabled:boolean; ready:boolean; withdrawalMode:string;
  customer:{verified:boolean;blocked:boolean}|null;
  wallet:{available:number;reserved:number}; destinations:Recipient[]; verifications:Review[]; transactions:Entry[];
  legacyDestinations?:LegacyRecipient[];
};
const php=(value:number)=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(value/100);
const label=(method:string)=>method==='maya'?'Maya':'GCash';
const statusLabel=(status:string)=>status==='reserved'?'Pending approval':status.replaceAll('_',' ');

export default function ManualWithdrawal({ bankOnly=false,onBack }:{bankOnly?:boolean;onBack?:()=>void}) {
  const [data,setData]=useState<Wallet|null>(null);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[refreshing,setRefreshing]=useState(false);
  const [amount,setAmount]=useState('60'),[recipient,setRecipient]=useState('');
  const [method,setMethod]=useState('gcash'),[name,setName]=useState(''),[number,setNumber]=useState('');
  const locked=useRef(false);
  const refresh=useCallback(async()=>{
    setRefreshing(true);
    try {setData(await moneyRequest('/api/money'));setError('');}
    catch(e){setError(e instanceof Error?e.message:'Unable to load withdrawal details.');}
    finally{setRefreshing(false);}
  },[]);
  useEffect(()=>{void refresh();},[refresh]);
  const recipients=(data?.destinations ?? []).filter(d=>['gcash','maya'].includes(d.method));
  const legacy=(data?.legacyDestinations ?? []).filter(d=>!recipients.some(r=>r.method===d.provider && r.account_number===d.account_number));
  const savedCount=recipients.length+legacy.length;
  const selected=recipients.find(d=>d.id===recipient) ?? recipients[0];
  const approved=!!selected?.verified && !!data?.verifications.some(v=>v.destination_id===selected.id && v.status==='approved' && !!v.expires_at && Date.parse(v.expires_at)>Date.now());
  const value=Number(amount),cents=Math.round(value*100);
  const valid=amount.trim()!=='' && Number.isFinite(value) && Number.isSafeInteger(cents) && Math.abs(value*100-cents)<0.000001 && cents>=6000 && cents<=5000000;
  const fee=valid?withdrawalFee(cents):0;
  const eligible=!!data && data.manualGoTyme && data.withdrawalMode==='admin_approval' && data.payoutsEnabled && data.ready && data.customer?.verified && !data.customer.blocked;
  const chosenMethod=method;
  const history=(data?.transactions ?? []).filter(t=>t.kind==='withdrawal');

  async function save(event:React.FormEvent) {
    event.preventDefault();if(locked.current || !data)return;
    locked.current=true;setBusy(true);setError('');setNotice('');
    try {
      await moneyRequest('/api/money',{action:'destination',method:chosenMethod,accountName:name.trim(),accountNumber:number.trim()});
      setNotice('Payment account saved. Identity and account ownership approval are required before withdrawal.');
      setName('');setNumber('');await refresh();
    } catch(e){setError(e instanceof Error?e.message:'Unable to save bank account.');}
    finally{locked.current=false;setBusy(false);}
  }
  async function withdraw(event:React.FormEvent) {
    event.preventDefault();if(locked.current || !eligible || !selected || !approved || !valid)return;
    if(!window.confirm(`Request ${php(cents)} withdrawal to ${label(selected.method)} ••••${selected.account_number.slice(-4)}? Fee: ${php(fee)}. You receive: ${php(cents-fee)}. The amount will be reserved pending admin review.`))return;
    locked.current=true;setBusy(true);setError('');setNotice('');
    try {
      const fingerprint=JSON.stringify({amount:cents,destination:selected.id});
      const saved=sessionStorage.getItem('aurevia-manual-withdrawal');
      let pending=saved?JSON.parse(saved):null;
      if(!pending || pending.fingerprint!==fingerprint)pending={fingerprint,key:crypto.randomUUID()};
      sessionStorage.setItem('aurevia-manual-withdrawal',JSON.stringify(pending));
      const result=await moneyRequest('/api/money',{action:'withdrawal',amount:value,method:selected.method,destinationId:selected.id,idempotencyKey:pending.key});
      sessionStorage.removeItem('aurevia-manual-withdrawal');
      setNotice(result.message ?? 'Withdrawal request submitted. The amount is reserved pending administrator approval.');
      await refresh();
    }catch(e){setError(e instanceof Error?e.message:'Unable to confirm withdrawal. Refresh before retrying.');}
    finally{locked.current=false;setBusy(false);}
  }

  return <main className={styles.root}><div className={styles.shell}>
    {bankOnly ? <header className={styles.bankHeader}>
      {onBack?<button type="button" className={styles.backCircle} onClick={onBack} aria-label="Back to Profile"><ArrowLeft size={19}/></button>:<Link className={styles.backCircle} href="/withdrawal" aria-label="Back to withdrawal"><ArrowLeft size={19}/></Link>}
      <span className={styles.eyebrow}>AUREVIA</span><h1>Payment Accounts</h1><p>{!data?(refreshing?'Loading saved accounts…':'Account details unavailable.'):savedCount?`${savedCount} saved account${savedCount===1?'':'s'}`:'No GCash or Maya account saved yet'}</p>
    </header> : <header className={styles.header}>
      <Link className={styles.back} href="/dashboard"><ArrowLeft size={17}/> Back to Home</Link>
      <span className={styles.eyebrow}>Withdrawal</span>
      <h1>Withdraw your <em>earnings</em></h1>
      <p>Withdraw your available balance to your linked account.</p>
    </header>}
    <div className={styles.content}>
      {error && <div role="alert" className={styles.error}>{error}{error==='Please sign in' && <> <Link href="/login">Log in</Link></>}</div>}
      {notice && <div role="status" className={styles.success}><CheckCircle2 size={18}/><span>{notice}</span></div>}
      {bankOnly ? <>
        <form className={styles.bankForm} onSubmit={e=>void save(e)}>
          <fieldset disabled={!data || busy}>
            <legend>Choose your e-wallet</legend>
            <div className={styles.methods}>{['gcash','maya'].map(m=><button type="button" key={m} aria-pressed={chosenMethod===m} className={chosenMethod===m?styles.selectedMethod:styles.method} onClick={()=>setMethod(m)}>{label(m)}</button>)}</div>
            <label className={styles.bankLabel}>{label(chosenMethod)} mobile number<input value={number} onChange={e=>setNumber(e.target.value.replace(/\D/g,''))} inputMode="numeric" autoComplete="off" placeholder="09XXXXXXXXX" pattern="09[0-9]{9}" maxLength={11} required/><small>11 digits, starting with 09</small></label>
            <label className={styles.bankLabel}>Registered account name<input value={name} onChange={e=>setName(e.target.value)} autoComplete="name" placeholder="Full name registered with your e-wallet" minLength={2} maxLength={100} required/></label>
            <button className={styles.primary} type="submit"><Save size={17}/>{busy?'Saving…':'Save Payment Account'}</button>
            <p className={styles.bankHelp}>Make sure the account number and name match your {label(chosenMethod)} account. Withdrawals are sent to these details after approval.</p>
          </fieldset>
        </form>
        {data && <section className={styles.savedAccounts}><div className={styles.sectionHeading}><h2>Saved accounts</h2><button type="button" aria-label="Refresh saved accounts" disabled={refreshing || busy} onClick={()=>void refresh()}><RefreshCw size={17}/></button></div>{!savedCount && <p>No GCash or Maya accounts saved yet.</p>}{recipients.map(d=><article key={d.id}><strong>{label(d.method)} · ••••{d.account_number.slice(-4)}</strong><p>{d.account_name}</p><span>{d.verified && data.verifications.some(v=>v.destination_id===d.id && v.status==='approved' && !!v.expires_at && Date.parse(v.expires_at)>Date.now())?'Ownership approved':'Ownership review required'}</span></article>)}{legacy.map(d=><article key={`legacy-${d.id}`}><strong>{label(d.provider)} · ••••{d.account_number.slice(-4)}</strong><p>{d.account_name}</p><span>Previously saved · Not yet linked for withdrawals</span><button type="button" className={styles.linkExisting} disabled={busy} onClick={()=>{setMethod(d.provider);setName(d.account_name);setNumber(d.account_number);setNotice('Saved details filled above. Check them, then save to link this account for withdrawal review.');window.scrollTo({top:0,behavior:'smooth'});}}>Use these details</button></article>)}<Link href="/withdrawal">Go to withdrawal →</Link></section>}
      </> : <>
        <form className={styles.card} onSubmit={e=>void withdraw(e)}>
          <h2>Request a withdrawal</h2>
          {!data ? <p className={styles.muted}>{refreshing?'Loading account…':'Account details unavailable.'}</p> : !selected ? <p className={styles.accountNotice}>No bank account linked yet. <Link href="/bank-account">Bind one now</Link></p> : <div className={styles.linkedAccount}><div><span>{label(selected.method)}</span><strong>•••• {selected.account_number.slice(-4)}</strong><small>{selected.account_name}</small></div><Link href="/bank-account">Manage</Link></div>}
          {recipients.length>1 && <label className={styles.amountLabel}>Receiving account<select value={selected?.id ?? ''} onChange={e=>setRecipient(e.target.value)} disabled={busy}>{recipients.map(d=><option key={d.id} value={d.id}>{label(d.method)} · ••••{d.account_number.slice(-4)}</option>)}</select></label>}
          <div className={styles.balance}><span>Available balance</span><strong>{data?php(data.wallet.available):'—'}</strong></div>
          {data && (!data.manualGoTyme || data.withdrawalMode!=='admin_approval') && <p className={styles.reviewNote}>Manual withdrawals are currently unavailable. Contact support.</p>}
          <label className={styles.amountLabel}>Amount (minimum ₱60)<input type="number" min="60" max="50000" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} disabled={busy} required/></label>
          <div className={styles.fees}><div><span>Platform fee (5%)</span><strong>{valid?php(fee):'—'}</strong></div><div><span>You will receive</span><strong>{valid?php(cents-fee):'—'}</strong></div></div>
          {data && selected && (!approved || !eligible) && <p className={styles.reviewNote}>Identity and recipient approval are required. <a href="#withdrawal-verification">View verification</a></p>}
          {data && valid && cents>Number(data.wallet.available) && <p className={styles.reviewNote}>The amount exceeds your available balance.</p>}
          <button className={styles.primary} type="submit" disabled={busy || !eligible || !approved || !valid || !selected || cents>Number(data?.wallet.available ?? 0)}>{busy?'Submitting…':'Submit withdrawal request'}</button>
        </form>
        <section className={styles.history}><div className={styles.sectionHeading}><h2>Withdrawal history</h2><button type="button" aria-label="Refresh withdrawal history" disabled={refreshing || busy} onClick={()=>void refresh()}><RefreshCw size={17}/></button></div>
          {!data?<div className={styles.empty}>Waiting for account details…</div>:!history.length?<div className={styles.empty}>No withdrawal requests yet.</div>:history.map(t=><article className={styles.historyItem} key={t.id}><div><strong>{php(Number(t.amount))}</strong><span>{new Date(t.created_at).toLocaleString('en-PH')}</span><small className={styles.reference}>{t.id}</small></div><span className={styles.status} data-status={t.status}>{statusLabel(t.status)}</span></article>)}
        </section>
        {data && <details className={styles.verification} id="withdrawal-verification"><summary>Identity &amp; account verification</summary><MemberVerification reviews={data.verifications} recipients={data.destinations} onRefresh={refresh}/></details>}
      </>}
    </div>
  </div></main>;
}
