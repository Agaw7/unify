'use client';

import { formatPhp } from '@/lib/format-php';
import Link from 'next/link';
import { ArrowLeft, RefreshCw, Save, CheckCircle2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { moneyRequest } from '@/lib/money-client';
import { withdrawalFee } from '@/lib/withdrawal-fee';
import { isWithdrawalOpen, withdrawalHoursMessage } from '@/lib/withdrawal-hours';
import styles from './manual-withdrawal.module.css';

type Recipient = { id:string; method:string; account_name:string; account_number:string };
type LegacyRecipient = {id:string;provider:string;account_name:string;account_number:string};
type Wallet = {
  manualWithdrawalAvailable:boolean; ready:boolean;
  customer:{verified:boolean;blocked:boolean}|null;
  wallet:{available:number;reserved:number}; destinations:Recipient[];
  legacyDestinations?:LegacyRecipient[];
};
const php=(value:number)=>formatPhp(value/100);
const label=(method:string)=>method==='maya'?'Maya':'GCash';

export default function ManualWithdrawal({ bankOnly=false,onBack }:{bankOnly?:boolean;onBack?:()=>void}) {
  const [data,setData]=useState<Wallet|null>(null);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[refreshing,setRefreshing]=useState(false);
  const [amount,setAmount]=useState('60'),[recipient,setRecipient]=useState('');
  const [method,setMethod]=useState('gcash'),[name,setName]=useState(''),[number,setNumber]=useState('');
  const [withdrawalOpen,setWithdrawalOpen]=useState(isWithdrawalOpen);
  const locked=useRef(false);
  const refresh=useCallback(async()=>{
    setRefreshing(true);
    try {setData(await moneyRequest('/api/money'));setError('');}
    catch(e){setError(e instanceof Error?e.message:'Unable to load withdrawal details.');}
    finally{setRefreshing(false);}
  },[]);
  useEffect(()=>{void refresh();},[refresh]);
  useEffect(()=>{
    if(bankOnly)return;
    const update=()=>setWithdrawalOpen(isWithdrawalOpen());
    update();
    const timer=window.setInterval(update,1000);
    return ()=>window.clearInterval(timer);
  },[bankOnly]);
  const recipients=(data?.destinations ?? []).filter(d=>['gcash','maya'].includes(d.method));
  const legacy=(data?.legacyDestinations ?? []).filter(d=>!recipients.some(r=>r.method===d.provider && r.account_number===d.account_number));
  const savedCount=recipients.length+legacy.length;
  const selected=recipients.find(d=>d.id===recipient) ?? recipients[0];
  const value=Number(amount),cents=Math.round(value*100);
  const valid=amount.trim()!=='' && Number.isFinite(value) && Number.isSafeInteger(cents) && Math.abs(value*100-cents)<0.000001 && cents>=6000 && cents<=5000000;
  const fee=valid?withdrawalFee(cents):0;
  const chosenMethod=method;

  async function save(event:React.FormEvent) {
    event.preventDefault();if(locked.current || !data)return;
    locked.current=true;setBusy(true);setError('');setNotice('');
    try {
      await moneyRequest('/api/money',{action:'destination',method:chosenMethod,accountName:name.trim(),accountNumber:number.trim()});
      setNotice('Payment account saved. You can submit a withdrawal request for admin review.');
      setName('');setNumber('');await refresh();
    } catch(e){setError(e instanceof Error?e.message:'Unable to save bank account.');}
    finally{locked.current=false;setBusy(false);}
  }
  async function withdraw(event:React.FormEvent) {
    event.preventDefault();
    if(locked.current || !data?.manualWithdrawalAvailable || data.customer?.blocked || !selected || !valid || cents>Number(data.wallet.available))return;
    if(!isWithdrawalOpen()){setWithdrawalOpen(false);return;}
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
      <span className={styles.eyebrow}>AROMEVA</span><h1>Payment Accounts</h1><p>{!data?(refreshing?'Loading saved accounts…':'Account details unavailable.'):savedCount?`${savedCount} saved account${savedCount===1?'':'s'}`:'No GCash or Maya account saved yet'}</p>
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
        {data && <section className={styles.savedAccounts}><div className={styles.sectionHeading}><h2>Saved accounts</h2><button type="button" aria-label="Refresh saved accounts" disabled={refreshing || busy} onClick={()=>void refresh()}><RefreshCw size={17}/></button></div>{!savedCount && <p>No GCash or Maya accounts saved yet.</p>}{recipients.map(d=><article key={d.id}><strong>{label(d.method)} · ••••{d.account_number.slice(-4)}</strong><p>{d.account_name}</p></article>)}{legacy.map(d=><article key={`legacy-${d.id}`}><strong>{label(d.provider)} · ••••{d.account_number.slice(-4)}</strong><p>{d.account_name}</p><span>Previously saved · Not yet linked for withdrawals</span><button type="button" className={styles.linkExisting} disabled={busy} onClick={()=>{setMethod(d.provider);setName(d.account_name);setNumber(d.account_number);setNotice('Saved details filled above. Check them, then save to link this account for withdrawal review.');window.scrollTo({top:0,behavior:'smooth'});}}>Use these details</button></article>)}<Link href="/withdrawal">Go to withdrawal →</Link></section>}
      </> : <>
        <form className={styles.card} onSubmit={e=>void withdraw(e)}>
          <h2>Request a withdrawal</h2>
          {!data ? <p className={styles.muted}>{refreshing?'Loading account…':'Account details unavailable.'}</p> : !selected ? <p className={styles.accountNotice}>No bank account linked yet. <Link href="/bank-account">Bind one now</Link></p> : <div className={styles.linkedAccount}><div><span>{label(selected.method)}</span><strong>•••• {selected.account_number.slice(-4)}</strong><small>{selected.account_name}</small></div><Link href="/bank-account">Manage</Link></div>}
          {recipients.length>1 && <label className={styles.amountLabel}>Receiving account<select value={selected?.id ?? ''} onChange={e=>setRecipient(e.target.value)} disabled={busy}>{recipients.map(d=><option key={d.id} value={d.id}>{label(d.method)} · ••••{d.account_number.slice(-4)}</option>)}</select></label>}
          <div className={styles.balance}><span>Available balance</span><strong>{data?php(data.wallet.available):'—'}</strong></div>
          {data && !data.manualWithdrawalAvailable && <p className={styles.reviewNote}>Manual withdrawals are currently unavailable. Contact support.</p>}
          <label className={styles.amountLabel}>Amount (minimum ₱60)<input type="number" min="60" max="50000" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} disabled={busy} required/></label>
          <div className={styles.fees}><div><span>Platform fee (5%)</span><strong>{valid?php(fee):'—'}</strong></div><div><span>You will receive</span><strong>{valid?php(cents-fee):'—'}</strong></div></div>
          {data?.customer?.blocked && <p className={styles.reviewNote}>Your account is restricted from withdrawals. Contact support.</p>}
          {data && valid && cents>Number(data.wallet.available) && <p className={styles.reviewNote}>The amount exceeds your available balance.</p>}
          <p className={styles.reviewNote}>{withdrawalHoursMessage}</p>
          <button className={styles.primary} type="submit" disabled={busy || !withdrawalOpen || !data?.manualWithdrawalAvailable || !!data.customer?.blocked || !valid || !selected || cents>Number(data.wallet.available)}>{busy?'Submitting…':withdrawalOpen?'Submit withdrawal request':'Withdrawals closed'}</button>
        </form>
      </>}
    </div>
  </div></main>;
}
