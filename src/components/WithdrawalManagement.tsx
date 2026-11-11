'use client';

import { formatPhp } from '@/lib/format-php';
import { withdrawalPayout } from '@/lib/withdrawal-fee';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { Check, Copy, RefreshCw, ShieldAlert, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import MoneyAdminMFA from './MoneyAdminMFA';
import styles from './withdrawal-management.module.css';

type Status = 'reserved' | 'approved' | 'processing' | 'rejected' | 'failed' | 'completed';
type Withdrawal = {
  id: string;
  user_id: string;
  method: string;
  amount: number;
  withdrawal_fee: number;
  status: Status;
  created_at: string;
  destination_snapshot: { name?: string; number?: string; bic?: string } | null;
  reviewed_by: string | null;
  canRecordPayout: boolean;
  canReject: boolean;
  payout_confirmed_at: string | null;
  hasPayoutProof: boolean;
  member: { phone: string | null; name: string | null };
};
type State = { transactions: Withdrawal[]; canConfirmPayout: boolean; recordsHidden?: boolean };
const tabs = ['Pending', 'Approved', 'Rejected'] as const;
type Tab = typeof tabs[number];

const currency = (cents: number) => formatPhp(cents / 100);
const paymentMethod = (method: string) => ({ gotyme: 'GoTyme Bank', gcash: 'GCash', maya: 'Maya' }[method] ?? method);
const dateTime = (value: string) => new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
const getTab = (status: Status): Tab | null => status === 'reserved' || status === 'approved' || status === 'processing' ? 'Pending'
  : status === 'completed' ? 'Approved'
    : status === 'rejected' || status === 'failed' ? 'Rejected' : null;

async function request(path: string, init?: RequestInit) {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error('Please sign in as an administrator.');
  const response = await fetch(path, {
    ...init,
    headers: { Authorization: `Bearer ${data.session.access_token}`, ...init?.headers },
    cache: 'no-store',
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new Error(result?.error ?? 'Unable to complete withdrawal operation.');
  }
  return response;
}

export default function WithdrawalManagement({ onCompleted }: { onCompleted: () => void }) {
  const [data, setData] = useState<State | null>(null);
  const [tab, setTab] = useState<Tab>('Pending');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reviewReason, setReviewReason] = useState('');
  const [activeAction, setActiveAction] = useState<'payout' | 'reject' | null>(null);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [savedProofUrl, setSavedProofUrl] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await request('/api/admin/withdrawals');
      setData(await response.json());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load withdrawals.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const records = useMemo(() => data?.transactions ?? [], [data?.transactions]);
  const selected = records.find(item => item.id === selectedId) ?? null;
  const canOpenPayout = selected?.canRecordPayout || (selected?.status === 'reserved' && selected.canReject);
  const visible = records.filter(item => getTab(item.status) === tab);
  const counts = useMemo(() => ({
    Pending: records.filter(item => getTab(item.status) === 'Pending').length,
    Approved: records.filter(item => getTab(item.status) === 'Approved').length,
    Rejected: records.filter(item => getTab(item.status) === 'Rejected').length,
  }), [records]);
  const fee = selected?.withdrawal_fee ?? 0;
  const payout = selected ? withdrawalPayout(selected) : 0;

  useEffect(() => {
    let active = true;
    let objectUrl = '';
    setSavedProofUrl('');
    if (!selected?.hasPayoutProof) return;
    void request(`/api/admin/withdrawals/${encodeURIComponent(selected.id)}/proof`)
      .then(response => response.blob())
      .then(blob => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setSavedProofUrl(objectUrl);
      })
      .catch(cause => {
        if (active) setError(cause instanceof Error ? cause.message : 'Unable to load payout screenshot.');
      });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [selected?.id, selected?.hasPayoutProof]);

  async function copyAccountNumber() {
    const number = selected?.destination_snapshot?.number;
    if (!number) return;
    try {
      await navigator.clipboard.writeText(number);
      setNotice('Account number copied.');
    } catch {
      setError('Unable to copy the account number. Check browser clipboard permissions.');
    }
  }

  async function confirmPayout() {
    if (!selected || busy || mfaRequired || !data?.canConfirmPayout || !selected.canRecordPayout) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await request('/api/admin/withdrawals/' + encodeURIComponent(selected.id), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm_sent' }),
      });
      setNotice('Payout recorded. The withdrawal is now in Approved.');
      setTab('Approved');
      setSelectedId(null);
      setActiveAction(null);
      await load();
      onCompleted();
    } catch (cause) {
      if (cause instanceof Error && cause.message === 'Administrator MFA required') {
        setMfaRequired(true);
      } else {
        setError(cause instanceof Error ? cause.message : 'Unable to confirm payout.');
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  async function reviewWithdrawal(action: 'approve' | 'reject') {
    if (!selected || busy || reviewReason.trim().length < 5) return;
    if (action === 'approve' && (selected.status !== 'reserved' || !data?.canConfirmPayout)) return;
    if (action === 'reject' && !selected.canReject) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await request('/api/admin/money', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selected.id, action, reason: reviewReason.trim() }),
      });
      setReviewReason('');
      if (action === 'reject') {
        setSelectedId(null);
        setActiveAction(null);
        setTab('Rejected');
        setNotice('Withdrawal rejected. The reserved amount was returned to the member.');
      } else {
        setNotice('Review recorded. You can now record the verified payout.');
      }
      await load();
      onCompleted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update the withdrawal.');
    } finally {
      setBusy(false);
    }
  }

  function closeDetails() {
    if (busy) return;
    setSelectedId(null);
    setReviewReason('');
    setActiveAction(null);
    setMfaRequired(false);
    setSavedProofUrl('');
    setNotice('');
    setError('');
  }

  return <section className={styles.management} aria-labelledby="withdrawals-title">
    <header className={styles.heading}>
      <div><h2 id="withdrawals-title">Withdrawals Management</h2><p>Manage withdrawals without leaving the admin panel</p></div>
      <button type="button" className={styles.refresh} onClick={() => void load()} disabled={loading}><RefreshCw size={16} className={loading ? styles.spinning : ''} /> Refresh</button>
    </header>
    <section className={styles.records} aria-label="Withdrawal records">
      <h3>Withdrawal Records</h3>
      <div className={styles.tabs} role="tablist" aria-label="Withdrawal status">
        {tabs.map(item =>
          <button type="button" role="tab" aria-selected={tab === item} key={item} onClick={() => setTab(item)}>{item}{data?.recordsHidden ? '' : ` (${counts[item]})`}</button>)}
      </div>
      {!selected && error && <p className={styles.error} role="alert">{error}</p>}
      {!selected && notice && <p className={styles.notice} role="status">{notice}</p>}
      <div className={styles.paymentCardList}>
        {!data?.recordsHidden && visible.map(item => (
          <article className={styles.paymentCard} key={item.id}>
            <div className={styles.recordId}>
              <strong className={styles.paymentCardAmount}>{currency(item.amount)}</strong>
              <span className={`${styles.status} ${tab === 'Approved' ? styles.statusDone : tab === 'Rejected' ? styles.statusRejected : ''}`}>{tab}</span>
            </div>
            <p><strong>{item.member.name ?? item.destination_snapshot?.name ?? `Member ${item.user_id.slice(0, 8)}`}</strong> · {dateTime(item.created_at)}</p>
            <p>Phone {item.member.phone ?? 'Unavailable'} · {paymentMethod(item.method)}</p>
            <p>Receiving account {item.destination_snapshot?.number ?? 'Unavailable'}</p>
            <p>Request WD-{item.id.slice(0, 8).toUpperCase()}</p>
            <p>Withdrawal fee {currency(item.withdrawal_fee ?? 0)}</p>
            {tab !== 'Rejected' && <p>{tab === 'Approved' ? 'Amount received' : 'Expected payout'} <strong>{currency(withdrawalPayout(item))}</strong></p>}
            <button type="button" className={styles.viewButton} onClick={() => { setError(''); setNotice(''); setActiveAction(null); setSelectedId(item.id); }}>View withdrawal details</button>
          </article>
        ))}
        {(!visible.length || data?.recordsHidden) && <p className={styles.empty}>{loading ? 'Loading withdrawals…' : data?.recordsHidden ? 'Withdrawal records are hidden on this dashboard. Stored records are unchanged.' : `No ${tab.toLowerCase()} withdrawals.`}</p>}
      </div>
    </section>

    {!data?.recordsHidden && selected && <div className={styles.overlay} onMouseDown={event => { if (event.target === event.currentTarget) closeDetails(); }}>
      <aside className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="withdrawal-details-title">
        <header className={styles.drawerHeader}><h2 id="withdrawal-details-title">Withdrawal Details</h2><button type="button" aria-label="Close withdrawal details" onClick={closeDetails}><X size={19} /></button></header>
        <div className={styles.drawerBody}>
          {error && <p className={styles.error} role="alert">{error}</p>}
          {notice && <p className={styles.notice} role="status">{notice}</p>}
          <section className={styles.detailCard}>
            <div className={styles.recordId}><strong>WD-{selected.id.slice(0, 8).toUpperCase()}</strong><span className={`${styles.status} ${selected.status === 'completed' ? styles.statusDone : selected.status === 'rejected' || selected.status === 'failed' ? styles.statusRejected : ''}`}>{selected.status}</span></div>
            <dl>
              <div><dt>Member Name</dt><dd>{selected.member.name ?? selected.destination_snapshot?.name ?? `Member ${selected.user_id.slice(0, 8)}`}</dd></div>
              <div><dt>Phone Number</dt><dd>{selected.member.phone ?? 'Unavailable'}</dd></div>
              <div><dt>Payment Method</dt><dd>{paymentMethod(selected.method)}</dd></div>
              <div><dt>Account Holder</dt><dd>{selected.destination_snapshot?.name ?? 'Unavailable'}</dd></div>
              <div><dt>Account Number</dt><dd className={styles.accountNumber}>{selected.destination_snapshot?.number ?? 'Unavailable'}{selected.destination_snapshot?.number && <button type="button" aria-label="Copy account number" onClick={() => void copyAccountNumber()}><Copy size={15} /></button>}</dd></div>
              <div><dt>Requested Amount</dt><dd>{currency(selected.amount)}</dd></div>
              <div><dt>Withdrawal Fee</dt><dd>{currency(fee)}</dd></div>
              <div className={styles.netPayout}><dt>Amount to Send</dt><dd>{currency(payout)}</dd></div>
              <div><dt>Request Date</dt><dd>{dateTime(selected.created_at)}</dd></div>
              <div><dt>Status</dt><dd>{selected.status}</dd></div>
              {selected.payout_confirmed_at && <div><dt>Payment Confirmed</dt><dd>{dateTime(selected.payout_confirmed_at)}</dd></div>}
            </dl>
          </section>

          {selected.hasPayoutProof && savedProofUrl && <section className={styles.detailCard}><h3>Payment Screenshot</h3><Image className={styles.savedProof} src={savedProofUrl} alt="Private payout confirmation screenshot" width={640} height={420} unoptimized /></section>}

          {activeAction === null && (canOpenPayout || selected.canReject) && <div className={styles.drawerActions}>
            {canOpenPayout && <button type="button" className={styles.approveButton} onClick={() => setActiveAction('payout')}>Confirm Manual Payout</button>}
            {selected.canReject && <button type="button" className={styles.rejectButton} onClick={() => setActiveAction('reject')}>Reject Withdrawal</button>}
          </div>}
          {activeAction === 'reject' && selected.canReject && <form className={styles.confirmCard} onSubmit={event => { event.preventDefault(); void reviewWithdrawal('reject'); }}>
            <label className={styles.uploadLabel} htmlFor="withdrawal-rejection-reason">Rejection reason</label>
            <textarea id="withdrawal-rejection-reason" className={styles.reviewReason} value={reviewReason} onChange={event => setReviewReason(event.target.value)} minLength={5} maxLength={500} required disabled={busy} />
            <div className={styles.drawerActions}>
              <button type="button" className={styles.cancelButton} disabled={busy} onClick={() => { setActiveAction(null); setReviewReason(''); }}>Back</button>
              <button type="submit" className={styles.rejectButton} disabled={busy || reviewReason.trim().length < 5}>{busy ? 'Rejecting…' : 'Confirm Rejection'}</button>
            </div>
          </form>}
          {activeAction === 'payout' && selected.canRecordPayout && !selected.hasPayoutProof && <section className={styles.confirmCard}>
            <h3>Confirm Manual Payout</h3>
            {!data?.canConfirmPayout && <p className={styles.lockNotice}><ShieldAlert size={16} /> Manual payout confirmation is unavailable in the current payment configuration.</p>}
            {mfaRequired && <div>
              <p>Verify your authenticator, then select Confirm Manual Payout again.</p>
              <MoneyAdminMFA onVerified={() => setMfaRequired(false)} />
            </div>}
            <div className={styles.drawerActions}><button type="button" className={styles.cancelButton} onClick={closeDetails} disabled={busy}>Cancel</button><button type="button" className={styles.approveButton} onClick={() => void confirmPayout()} disabled={busy || mfaRequired || !data?.canConfirmPayout}><Check size={16} />{busy ? 'Recording…' : 'Confirm Manual Payout'}</button></div>
          </section>}
          {activeAction === 'payout' && selected.status === 'reserved' && <form className={styles.confirmCard} onSubmit={event => { event.preventDefault(); void reviewWithdrawal('approve'); }}>
            <h3>Approve Withdrawal Review</h3>
            <p>Review the amount and receiving account before approving the request.</p>
            <label className={styles.uploadLabel} htmlFor="withdrawal-review-reason">Review reason</label>
            <textarea id="withdrawal-review-reason" className={styles.reviewReason} value={reviewReason} onChange={event => setReviewReason(event.target.value)} minLength={5} maxLength={500} required disabled={busy} />
            <div className={styles.drawerActions}>
              <button type="button" className={styles.cancelButton} disabled={busy} onClick={() => { setActiveAction(null); setReviewReason(''); }}>Back</button>
              <button type="submit" className={styles.approveButton} disabled={busy || !data?.canConfirmPayout || reviewReason.trim().length < 5}><Check size={16} />{busy ? 'Saving…' : 'Approve Review'}</button>
            </div>
          </form>}
          {['approved', 'processing'].includes(selected.status) && !selected.canRecordPayout && <p className={styles.lockNotice}>Payout confirmation is available for reviewed withdrawals belonging to another member.</p>}
        </div>
      </aside>
    </div>}
  </section>;
}
