"use client";

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import AureviaLogo from '@/components/AureviaLogo';
import { ArrowDownLeft, ArrowUpRight, BookOpen, ChevronRight, Eye, EyeOff, Headphones, Info, LockKeyhole, LogOut, UserRound, Wallet } from 'lucide-react';
import { moneyRequest } from '@/lib/money-client';
import { supabase } from '@/lib/supabase';

type ProfileData = {
  wallet: { available: number; held: number; reserved: number };
  totalEarned: number | null;
  transactions: { id: string; kind: string; amount: number; status: string; created_at: string }[];
};
type Panel = 'Cash-out history' | 'About us' | 'Change password' | 'Edit profile';
const php = (amount: number | null | undefined) => Number.isSafeInteger(amount)
  ? new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(amount! / 100)
  : '—';

function PasswordField({ label, name, autoComplete, minLength }: {
  label: string; name: string; autoComplete: string; minLength?: number;
}) {
  const [visible, setVisible] = useState(false);
  return <div className="member-password-field">
    <label htmlFor={`profile-password-${name}`}>{label}</label>
    <div className="member-password-input">
      <input id={`profile-password-${name}`} type={visible ? 'text' : 'password'} name={name} autoComplete={autoComplete} minLength={minLength} required />
      <button type="button" aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`} onClick={() => setVisible(value => !value)}>
        {visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
      </button>
    </div>
  </div>;
}

async function passwordMfaFactor() {
  const { data: assurance, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw error;
  if (assurance.currentLevel === 'aal2' || assurance.nextLevel !== 'aal2') return null;

  const { data: factors, error: factorError } = await supabase.auth.mfa.listFactors();
  if (factorError) throw factorError;
  const factor = factors.totp.find(item => item.status === 'verified');
  if (!factor) throw new Error('Verify your enrolled MFA method before changing your password.');
  return factor.id;
}

export default function MemberProfile({ contact, name, verified, onBank, onLogout }: {
  contact: string; name?: string | null; verified: boolean; onBank: () => void; onLogout: () => void;
}) {
  const [data, setData] = useState<ProfileData | null>(null);
  const [error, setError] = useState('');
  const [displayName, setDisplayName] = useState(name ?? '');
  const [showContact, setShowContact] = useState(false);
  const [showBalance, setShowBalance] = useState(true);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [checkingMfa, setCheckingMfa] = useState(false);
  const [mfaFactor, setMfaFactor] = useState<string | null>(null);

  useEffect(() => {
    if (panel !== 'Change password') return;
    let active = true;
    void passwordMfaFactor().then(factor => {
      if (active) setMfaFactor(factor);
    }).catch(failure => {
      if (active) setStatus(failure instanceof Error ? failure.message : 'Unable to check MFA.');
    }).finally(() => { if (active) setCheckingMfa(false); });
    return () => { active = false; };
  }, [panel]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const result = await moneyRequest('/api/money?summary=profile');
        if (active) { setData(result); setError(''); }
      } catch { if (active) setError('Unable to load wallet details.'); }
    };
    void load();
    window.addEventListener('focus', load);
    void supabase.auth.getUser().then(({ data }) => {
      const savedName = data.user?.user_metadata?.display_name;
      if (active && typeof savedName === 'string') setDisplayName(savedName);
    });
    return () => { active = false; window.removeEventListener('focus', load); };
  }, []);

  const phone = /^(?:\+?63|0)(\d{3})\d{3}(\d{4})$/.exec(contact);
  const member = displayName.trim() || (phone ? `AUREVIA ${phone[2]}` : 'AUREVIA Member');
  const maskedContact = phone ? `+63 ${phone[1]}***${phone[2]}` : '••••••';
  const amount = (value: number | null | undefined) => showBalance ? php(value) : '••••';
  const open = (next: Panel) => {
    setStatus('');
    setMfaFactor(null);
    setCheckingMfa(next === 'Change password');
    setPanel(next);
    window.scrollTo({ top: 0 });
  };
  const rows = [
    { title: 'History', items: [
      { label: 'Top-up history', icon: BookOpen, href: '/deposit/history' },
      { label: 'Cash-out history', icon: BookOpen, action: () => open('Cash-out history') },
    ] },
    { title: 'Services', items: [
      { label: 'Customer service', icon: Headphones, href: 'https://t.me/+q6uAIuQt50VlMjBl' },
      { label: 'About us', icon: Info, action: () => open('About us') },
    ] },
    { title: 'Settings', items: [
      { label: 'Change password', icon: LockKeyhole, action: () => open('Change password') },
      { label: 'Edit profile', icon: UserRound, action: () => open('Edit profile') },
      { label: 'Bank account', icon: Wallet, action: onBank },
      { label: 'Logout', icon: LogOut, action: onLogout },
    ] },
  ];

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setBusy(true);
    setStatus('');
    try {
      if (panel === 'Edit profile') {
        const nextName = String(fields.get('name') ?? '').trim();
        if (!nextName || nextName.length > 60) throw new Error('Enter a name from 1 to 60 characters.');
        const { error } = await supabase.auth.updateUser({ data: { display_name: nextName } });
        if (error) throw error;
        setDisplayName(nextName);
        setStatus('Display name updated.');
      } else {
        const password = String(fields.get('password') ?? '');
        if (password.length < 6 || password !== fields.get('confirm')) throw new Error('Enter matching passwords with at least 6 characters.');
        const factor = await passwordMfaFactor();
        if (factor) {
          setMfaFactor(factor);
          const code = String(fields.get('mfa-code') ?? '').trim();
          if (!/^\d{6}$/.test(code)) throw new Error('Enter the 6-digit code from your authenticator app.');
          const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor, code });
          if (verifyError) throw verifyError;
          setMfaFactor(null);
        }
        const { error } = await supabase.auth.updateUser({ password, current_password: String(fields.get('current') ?? '') });
        if (error) throw error;
        form.reset();
        setStatus('Password updated.');
      }
    } catch (failure) { setStatus(failure instanceof Error ? failure.message : 'Unable to save changes.'); }
    finally { setBusy(false); }
  }

  if (panel) return <section className="member-profile member-profile-detail">
    <button type="button" className="member-profile-back" disabled={busy} onClick={() => setPanel(null)}>← Back to Profile</button>
    <h2>{panel}</h2>
    {panel === 'About us' && <p>AUREVIA brings your tier plans, wallet, and rewards together in one account.</p>}
    {panel === 'Cash-out history' && <>
      {error && <p role="alert">{error}</p>}
      {!data && !error && <p>Loading cash-out history…</p>}
      {data && !data.transactions.some(entry => entry.kind === 'withdrawal') && <p>No recent cash-outs.</p>}
      {data?.transactions.filter(entry => entry.kind === 'withdrawal').map(entry => <article className="member-cashout" key={entry.id}>
        <strong>{php(entry.amount)}</strong><span>{entry.status.replaceAll('_', ' ')}</span><small>{new Date(entry.created_at).toLocaleString()}</small>
      </article>)}
    </>}
    {(panel === 'Edit profile' || panel === 'Change password') && <form onSubmit={save}>
      {panel === 'Edit profile' ? <label>Display name<input name="name" defaultValue={displayName} maxLength={60} required /></label> : <>
        <PasswordField label="Current password" name="current" autoComplete="current-password" />
        <PasswordField label="New password" name="password" autoComplete="new-password" minLength={6} />
        <PasswordField label="Confirm new password" name="confirm" autoComplete="new-password" minLength={6} />
        {mfaFactor && <label>Authenticator code
          <input name="mfa-code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required />
          <small>Enter the 6-digit code from your authenticator app to verify and save.</small>
        </label>}
      </>}
      <button type="submit" className="invest-now-button" disabled={busy || checkingMfa}>{checkingMfa ? 'Checking MFA…' : busy ? 'Saving…' : mfaFactor ? 'Verify and save' : 'Save changes'}</button>
      {status && <p role="status">{status}</p>}
    </form>}
  </section>;

  return <section className="member-profile" aria-label="Profile">
    <div className="member-identity">
      <AureviaLogo className="member-brand-avatar" />
      <div><h2>{member}</h2><div className="member-contact">
        <span>{contact ? (showContact ? contact : maskedContact) : '—'}</span>
        <button type="button" aria-label={showContact ? 'Hide contact' : 'Show contact'} onClick={() => setShowContact(!showContact)}>{showContact ? <EyeOff size={17} /> : <Eye size={17} />}</button>
      </div><small>{verified ? 'Account verified' : 'Account not verified'}</small></div>
      <button className="member-profile-edit" type="button" aria-label="Edit profile" onClick={() => open('Edit profile')}><ChevronRight size={22} /></button>
    </div>
    <section className="member-wallet" aria-label="Profile wallet">
      <div className="member-wallet-label">Available balance <button type="button" aria-label={showBalance ? 'Hide balances' : 'Show balances'} onClick={() => setShowBalance(!showBalance)}>{showBalance ? <Eye size={18} /> : <EyeOff size={18} />}</button></div>
      <strong className="member-wallet-amount">{amount(data?.wallet.available)}</strong>
      <div className="member-wallet-stats"><span>On hold <b>{amount(data ? data.wallet.held + data.wallet.reserved : null)}</b></span><span>Total earned <b>{amount(data?.totalEarned)}</b></span></div>
      {error && <p role="alert">{error}</p>}
      <div className="member-wallet-actions"><Link href="/deposit"><ArrowDownLeft size={20} />Top up</Link><Link href="/withdraw"><ArrowUpRight size={20} />Cash out</Link></div>
    </section>
    {rows.map(group => <section key={group.title} className="member-menu-group" data-group={group.title}><h3>{group.title}</h3><div className="member-menu-list">
      {group.items.map(({ label, icon: Icon, href, action }) => {
        const content = <><span className="member-menu-icon"><Icon size={20} /></span><span>{label}</span><ChevronRight size={16} /></>;
        return href ? <Link key={label} href={href} target={href.startsWith('https:') ? '_blank' : undefined} rel={href.startsWith('https:') ? 'noopener noreferrer' : undefined}>{content}</Link>
          : <button type="button" key={label} onClick={action}>{content}</button>;
      })}
    </div></section>)}
  </section>;
}
