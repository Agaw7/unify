'use client';
import { useRef, useState } from 'react';
import Image from 'next/image';
import { supabase } from '@/lib/supabase';
import { needsVerifiedMfaEmail } from '@/lib/mfa-readiness';
import styles from './money-admin-mfa.module.css';

export default function MoneyAdminMFA({ onVerified }: { onVerified:()=>void }) {
  const [factor,setFactor]=useState('');
  const [qr,setQr]=useState('');
  const [code,setCode]=useState('');
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const [needsEmail,setNeedsEmail]=useState(false);
  const [email,setEmail]=useState('');
  const lock=useRef(false);
  async function setup() {
    if(lock.current) return;
    lock.current=true;
    setBusy(true);setMessage('');
    try {
      const { data,error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      const existing = data.all.find(f=>f.factor_type==='totp' && f.status==='verified');
      if (existing?.status==='verified') { setFactor(existing.id);setMessage('Enter your authenticator code.');return; }
      const { data: identity, error: identityError } = await supabase.auth.getUser();
      if(identityError || !identity.user) throw new Error('Please sign in again before setting up your authenticator.');
      if(needsVerifiedMfaEmail(identity.user)) {
        setNeedsEmail(true);
        setMessage('Add and confirm an administrator email first. Supabase needs an email account label to generate the authenticator QR code for this phone-login account.');
        return;
      }
      setNeedsEmail(false);
      // Reuse the enrollment shown by this screen until its code is confirmed.
      if (factor && qr) { setMessage('Scan the displayed authenticator QR and enter its code.');return; }
      const unfinished = data.all.find(f=>f.factor_type==='totp' && f.status==='unverified' && f.friendly_name==='UNIFY payments');
      if (unfinished) {
        const { error: removalError } = await supabase.auth.mfa.unenroll({ factorId:unfinished.id });
        if (removalError) throw removalError;
      }
      const { data: enrolled,error: enrollmentError } = await supabase.auth.mfa.enroll({ factorType:'totp',friendlyName:'UNIFY payments',issuer:'UNIFY' });
      if (enrollmentError) throw enrollmentError;
      setFactor(enrolled.id);setQr(enrolled.totp.qr_code);setMessage('Scan with your authenticator, then enter its code.');
    } catch(e) { setMessage(e instanceof Error ? e.message : 'MFA setup failed'); }
    finally { lock.current=false;setBusy(false); }
  }
  async function requestEmailConfirmation() {
    if(lock.current) return;
    lock.current=true;setBusy(true);setMessage('');
    try {
      const requestedEmail=email.trim();
      const {data,error}=await supabase.auth.updateUser({email:requestedEmail}, {emailRedirectTo:new URL('/admin/money',window.location.origin).toString()});
      if(error) throw error;
      setEmail('');
      if(!needsVerifiedMfaEmail(data.user) && data.user.email?.toLowerCase()===requestedEmail.toLowerCase()) {
        setNeedsEmail(false);
        setMessage('Your email is ready for authenticator setup. Select Set up or verify MFA again to generate the QR code.');
      } else {
        setMessage('Check your email and confirm the address. Then return here and select Set up or verify MFA again. Your phone sign-in remains available.');
      }
    } catch(e) {setMessage(e instanceof Error ? e.message : 'Unable to send email confirmation.');}
    finally {lock.current=false;setBusy(false);}
  }
  async function verify() {
    if(lock.current) return;
    lock.current=true;
    setBusy(true);setMessage('');
    try {
      const { error }=await supabase.auth.mfa.challengeAndVerify({ factorId:factor,code });
      if(error) throw error;
      setQr('');setCode('');setMessage('MFA session verified.');onVerified();
    } catch(e) { setMessage(e instanceof Error ? e.message : 'MFA verification failed'); }
    finally { lock.current=false;setBusy(false); }
  }
  return <section className="space-y-3 rounded-xl border border-slate-700 p-4"><h2 className="text-lg">Administrator authenticator</h2>
    <button disabled={busy} onClick={()=>void setup()} className="text-cyan-300">Set up or verify MFA</button>
    {needsEmail && <form onSubmit={e=>{e.preventDefault();void requestEmailConfirmation();}} className="space-y-3 rounded-lg border border-amber-700 bg-slate-900 p-3">
      <p className="text-sm text-amber-200">A verified email is required for new authenticator enrollment. Use an email account you control.</p>
      <label className="block text-sm">Administrator email<input type="email" autoComplete="email" required maxLength={254} disabled={busy} value={email} onChange={e=>setEmail(e.target.value)} className="mt-2 w-full min-w-0 rounded-lg border border-slate-600 bg-slate-800 p-3"/></label>
      <button type="submit" disabled={busy} className="rounded-lg bg-blue-700 px-4 py-3 disabled:opacity-50">Add administrator email</button>
      <p className="text-xs text-slate-400">Confirm the email link yourself. Never share your confirmation link, enrollment QR, or authenticator code.</p>
    </form>}
    {qr && <Image unoptimized src={qr} width={200} height={200} alt="Authenticator enrollment QR code" className="bg-white"/>}
    {factor && <form onSubmit={e=>{e.preventDefault();void verify();}} className={styles.verifyForm}>
      <label className={styles.codeLabel}>
        Authenticator code
        <input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} placeholder="6-digit code" required value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,6))} className={styles.codeInput} />
      </label>
      <button type="submit" disabled={busy} className={styles.verifyButton}>Verify code</button>
    </form>}
    {message && <p role="status">{message}</p>}
  </section>;
}
