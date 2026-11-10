'use client';

import { formatPhp } from '@/lib/format-php';
import Image from 'next/image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ExternalLink, Image as ImageIcon, RefreshCw, ShieldAlert, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import styles from './withdrawal-management.module.css';

type Status = 'pending' | 'approved' | 'completed' | 'rejected' | 'failed';
type Deposit = {
  id: string;
  user_id: string;
  method: string;
  amount: number;
  status: Status;
  created_at: string;
  channel: 'palawan' | 'gcash' | null;
  submittedReference: string | null;
  hasReceipt: boolean;
  ownDeposit: boolean;
  member: { phone: string | null; name: string | null };
};
type State = { transactions: Deposit[]; canApprove: boolean; treasuryEnabled: boolean; recordsHidden?: boolean };
type Tab = 'Pending' | 'Approved' | 'Rejected' | 'Completed';

const currency = (cents: number) => formatPhp(cents / 100);
const paymentMethod = (item: Deposit) => item.channel === 'palawan' ? 'PalawanPay' : item.channel === 'gcash' ? 'GCash' : item.method.toUpperCase();
const dateTime = (value: string) => new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });

async function request(path: string, init?: RequestInit) {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error('Please sign in as an administrator.');
  const headers = new Headers(init?.headers);
  headers.set('authorization', ['Bearer', data.session.access_token].join(' '));
  const response = await fetch(path, { ...init, headers, cache: 'no-store' });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new Error(result?.error ?? 'Unable to complete deposit operation.');
  }
  return response;
}

function tabFor(deposit: Deposit): Tab {
  if (deposit.status === 'pending') return 'Pending';
  if (deposit.status === 'rejected' || deposit.status === 'failed') return 'Rejected';
  if (deposit.status === 'approved' || (deposit.status === 'completed' && deposit.channel)) return 'Approved';
  return 'Completed';
}

export default function DepositManagement({ onReviewed }: { onReviewed: () => void }) {
  const [data, setData] = useState<State | null>(null);
  const [tab, setTab] = useState<Tab>('Pending');
  const [showOwnDeposits, setShowOwnDeposits] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [proofUrl, setProofUrl] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [receivedAt, setReceivedAt] = useState('');
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await request('/api/admin/deposits');
      setData(await response.json());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load deposit records.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const records = useMemo(
    () => (data?.transactions ?? []).filter(item => showOwnDeposits || !item.ownDeposit),
    [data?.transactions, showOwnDeposits],
  );
  const selected = records.find(item => item.id === selectedId) ?? null;
  const visible = records.filter(item => tabFor(item) === tab);
  const counts = useMemo(() => ({
    Pending: records.filter(item => tabFor(item) === 'Pending').length,
    Approved: records.filter(item => tabFor(item) === 'Approved').length,
    Rejected: records.filter(item => tabFor(item) === 'Rejected').length,
    Completed: records.filter(item => tabFor(item) === 'Completed').length,
  }), [records]);

  useEffect(() => {
    let active = true;
    let objectUrl = '';
    setProofUrl('');
    if (!selected?.hasReceipt) return;
    void request(`/api/admin/deposits/${encodeURIComponent(selected.id)}/proof`)
      .then(response => response.blob())
      .then(blob => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setProofUrl(objectUrl);
      })
      .catch(cause => {
        if (active) setError(cause instanceof Error ? cause.message : 'Unable to load payment screenshot.');
      });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [selected?.id, selected?.hasReceipt]);

  function openDetails(deposit: Deposit) {
    setError('');
    setNotice('');
    setConfirm(false);
    setReason('');
    setPaymentReference(deposit.submittedReference?.replace(/^PALAWAN-REQUEST-[A-F0-9]{64}$/, '').replace(/^(PALAWAN|GCASH)-/, '') ?? '');
    setReceivedAt('');
    setSelectedId(deposit.id);
  }

  async function review(action: 'approve' | 'reject') {
    if (!selected || busy || selected.ownDeposit) return;
    if (action === 'approve') {
      if (!data?.canApprove || !confirm || selected.status !== 'pending') return;
      if (!window.confirm(`Confirm that you independently verified receipt of ${currency(selected.amount)} in the authorized ${paymentMethod(selected)} merchant account before approving this deposit?`)) return;
    } else {
      if (reason.trim().length < 5 || !window.confirm('Reject this deposit request without adding wallet credit?')) return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const payload = action === 'approve'
        ? { action, confirm, paymentReference: paymentReference.trim().toUpperCase(), receivedAt: receivedAt ? new Date(receivedAt).toISOString() : undefined }
        : { action, reason: reason.trim() };
      const response = await request(`/api/admin/deposits/${encodeURIComponent(selected.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      setNotice(result.message ?? 'Deposit review recorded.');
      setConfirm(false);
      await load();
      onReviewed();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to review this deposit.');
      await load();
    } finally { setBusy(false); }
  }

  function closeDetails() {
    setSelectedId(null);
    setProofUrl('');
    setConfirm(false);
    setNotice('');
    setError('');
  }

  return <section className={styles.management} aria-labelledby="deposits-title">
    <header className={styles.heading}>
      <div><h2 id="deposits-title">Deposits Management</h2><p>Review and manage member deposit requests</p></div>
      <button type="button" className={styles.refresh} onClick={() => void load()} disabled={loading}><RefreshCw size={16} className={loading ? styles.spinning : ''} /> Refresh</button>
    </header>
    <section className={styles.records} aria-label="Deposit records">
      <h3>Deposit Records</h3>
      <label className={styles.checkbox}>
        <input type="checkbox" checked={showOwnDeposits} onChange={event => setShowOwnDeposits(event.target.checked)} />
        <span>Show my deposits</span>
      </label>
      <div className={styles.tabs} role="tablist" aria-label="Deposit status">
        {(['Pending', 'Approved', 'Rejected', 'Completed'] as const).map(item =>
          <button type="button" role="tab" aria-selected={tab === item} key={item} onClick={() => setTab(item)}>{item}{data?.recordsHidden ? '' : ` (${counts[item]})`}</button>)}
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      <div className={styles.tableWrap}>
        <table className={styles.mobileTable}>
          <thead><tr><th>Member</th><th>Phone</th><th>Payment Method</th><th>Amount</th><th>Date Requested</th><th>Screenshot</th><th>Action</th></tr></thead>
          <tbody>{!data?.recordsHidden && visible.map(item => <tr key={item.id}>
            <td data-label="Member">{item.member.name ?? `Member ${item.user_id.slice(0, 8)}`}</td>
            <td data-label="Phone">{item.member.phone ?? '—'}</td>
            <td data-label="Payment Method">{paymentMethod(item)}</td>
            <td data-label="Amount">{currency(item.amount)}</td>
            <td data-label="Date Requested">{dateTime(item.created_at)}</td>
            <td data-label="Screenshot" aria-label={item.hasReceipt ? 'Screenshot uploaded' : 'No screenshot'}>{item.hasReceipt ? <ImageIcon size={17} /> : '—'}</td>
            <td data-label="Action"><button type="button" className={styles.viewButton} onClick={() => openDetails(item)}>View Details</button></td>
          </tr>)}
          {(!visible.length || data?.recordsHidden) && <tr><td colSpan={7} className={styles.empty}>{loading ? 'Loading deposits…' : data?.recordsHidden ? 'Deposit records are hidden on this dashboard. Stored records are unchanged.' : `No ${tab.toLowerCase()} deposits.`}</td></tr>}</tbody>
        </table>
      </div>
    </section>

    {!data?.recordsHidden && selected && <div className={styles.overlay} onMouseDown={event => { if (event.target === event.currentTarget) closeDetails(); }}>
      <aside className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="deposit-details-title">
        <header className={styles.drawerHeader}><h2 id="deposit-details-title">Deposit Details</h2><button type="button" aria-label="Close deposit details" onClick={closeDetails}><X size={19} /></button></header>
        <div className={styles.drawerBody}>
          <section className={styles.detailCard}>
            <div className={styles.recordId}><strong>DP-{selected.id.slice(0, 8).toUpperCase()}</strong><span className={`${styles.status} ${selected.status === 'completed' || selected.status === 'approved' ? styles.statusDone : selected.status === 'rejected' || selected.status === 'failed' ? styles.statusRejected : ''}`}>{selected.status}</span></div>
            <dl>
              <div><dt>Member ID</dt><dd>{selected.user_id}</dd></div>
              <div><dt>Phone Number</dt><dd>{selected.member.phone ?? 'Unavailable'}</dd></div>
              <div><dt>Deposit Request ID</dt><dd>{selected.id}</dd></div>
              <div><dt>Payment Method</dt><dd>{paymentMethod(selected)}</dd></div>
              <div><dt>Submitted Reference</dt><dd>{selected.submittedReference?.replace(/^PALAWAN-REQUEST-[A-F0-9]{64}$/, 'Screenshot only') ?? 'Unavailable'}</dd></div>
              <div><dt>Deposit Amount</dt><dd>{currency(selected.amount)}</dd></div>
              <div><dt>Request Date</dt><dd>{dateTime(selected.created_at)}</dd></div>
              <div><dt>Status</dt><dd>{selected.status}</dd></div>
            </dl>
          </section>

          <section className={styles.detailCard}>
            <h3>Payment Screenshot</h3>
            {!selected.hasReceipt && <p className={styles.lockNotice}><ShieldAlert size={16} /> No screenshot is attached to this record.</p>}
            {selected.hasReceipt && proofUrl && <>
              <a className={styles.fullImageLink} href={proofUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} /> View full-size screenshot</a>
              <Image className={styles.savedProof} src={proofUrl} alt="Private member payment screenshot" width={720} height={480} unoptimized />
            </>}
            {selected.hasReceipt && !proofUrl && <p className={styles.empty}>Loading secure screenshot…</p>}
          </section>

          {selected.status === 'pending' && selected.ownDeposit && (
            <p className={styles.lockNotice}><ShieldAlert size={16} /> You submitted this deposit. Another administrator must review it.</p>
          )}
          {selected.status === 'pending' && !selected.ownDeposit && <>
            <section className={styles.confirmCard}>
              <h3>Approve Deposit</h3>
              <p>Independently verify the amount and reference in the authorized merchant account history. A screenshot alone is not proof of receipt.</p>
              {!data?.canApprove && <p className={styles.lockNotice}><ShieldAlert size={16} /> Deposit approvals are paused pending independently verified authorization.</p>}
              <label className={styles.uploadLabel} htmlFor="verified-reference">Reference in merchant account history <span>*</span></label>
              <input id="verified-reference" className={styles.reviewInput} value={paymentReference} onChange={event => setPaymentReference(event.target.value)} disabled={busy} maxLength={72} />
              {selected.channel === 'palawan' && data?.treasuryEnabled && <label className={styles.uploadLabel} htmlFor="deposit-received-at">Actual received time <span>*</span><input id="deposit-received-at" type="datetime-local" className={styles.reviewInput} value={receivedAt} onChange={event => setReceivedAt(event.target.value)} disabled={busy} /></label>}
              <label className={styles.checkbox}><input type="checkbox" checked={confirm} onChange={event => setConfirm(event.target.checked)} disabled={busy || !data?.canApprove} /><span>I independently confirm the payment has been received in the authorized merchant account.</span></label>
              <button type="button" className={styles.approveButton} onClick={() => void review('approve')}
                disabled={busy || !data?.canApprove || !confirm || !/^[A-Z0-9-]{5,72}$/i.test(paymentReference.trim()) || (selected.channel === 'palawan' && Boolean(data?.treasuryEnabled) && !receivedAt)}>
                <Check size={16} />{busy ? 'Recording…' : 'Approve Deposit'}
              </button>
            </section>
            <section className={styles.confirmCard}>
              <h3>Reject Deposit</h3>
              <label className={styles.uploadLabel} htmlFor="deposit-rejection-reason">Reason <span>*</span></label>
              <textarea id="deposit-rejection-reason" className={styles.reviewInput} value={reason} onChange={event => setReason(event.target.value)} maxLength={500} rows={3} disabled={busy} />
              <button type="button" className={styles.rejectButton} onClick={() => void review('reject')} disabled={busy || reason.trim().length < 5}>Reject Deposit</button>
            </section>
          </>}
        </div>
      </aside>
    </div>}
  </section>;
}
