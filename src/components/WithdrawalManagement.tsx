'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { Check, Copy, ImagePlus, RefreshCw, ShieldAlert, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
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
  payout_confirmed_at: string | null;
  hasPayoutProof: boolean;
  member: { phone: string | null; name: string | null };
};
type State = { transactions: Withdrawal[]; canConfirmPayout: boolean; recordsHidden?: boolean };
type Tab = 'Pending' | 'Approved' | 'Rejected' | 'Completed';

const currency = (cents: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(cents / 100);
const paymentMethod = (method: string) => ({ gotyme: 'GoTyme Bank', gcash: 'GCash', maya: 'Maya' }[method] ?? method);
const dateTime = (value: string) => new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
const getTab = (status: Status): Tab => status === 'reserved' ? 'Pending'
  : status === 'approved' || status === 'processing' ? 'Approved'
    : status === 'rejected' || status === 'failed' ? 'Rejected' : 'Completed';

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
  const [proof, setProof] = useState<File | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [savedProofUrl, setSavedProofUrl] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await request('/api/admin/withdrawals?hideRecords=true');
      setData(await response.json());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load withdrawals.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!proof) { setPreviewUrl(''); return; }
    const url = URL.createObjectURL(proof);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [proof]);

  const records = useMemo(() => data?.transactions ?? [], [data?.transactions]);
  const selected = records.find(item => item.id === selectedId) ?? null;
  const visible = records.filter(item => getTab(item.status) === tab);
  const counts = useMemo(() => ({
    Pending: records.filter(item => getTab(item.status) === 'Pending').length,
    Approved: records.filter(item => getTab(item.status) === 'Approved').length,
    Rejected: records.filter(item => getTab(item.status) === 'Rejected').length,
    Completed: records.filter(item => getTab(item.status) === 'Completed').length,
  }), [records]);
  const fee = selected?.withdrawal_fee ?? 0;
  const payout = selected ? selected.amount - fee : 0;

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

  function chooseProof(file?: File) {
    setError('');
    setNotice('');
    if (!file) { setProof(null); return; }
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size < 8 || file.size > 5 * 1024 * 1024) {
      setError('Choose a PNG, JPG, or JPEG screenshot up to 5 MB.');
      setProof(null);
      return;
    }
    setProof(file);
  }

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
    if (!selected || !proof || !confirm || !data?.canConfirmPayout || selected.status !== 'processing') return;
    if (!window.confirm(`Confirm that you independently verified this completed transfer in the official account history and sent ${currency(payout)} to the recipient?`)) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const form = new FormData();
      form.set('proof', proof);
      form.set('confirm', 'true');
      await request(`/api/admin/withdrawals/${encodeURIComponent(selected.id)}`, { method: 'POST', body: form });
      setNotice('Payout confirmation recorded. The withdrawal is now completed.');
      setProof(null);
      setConfirm(false);
      await load();
      onCompleted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to confirm payout.');
      await load();
    } finally {
      setBusy(false);
    }
  }

  function closeDetails() {
    setSelectedId(null);
    setProof(null);
    setConfirm(false);
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
        {(['Pending', 'Approved', 'Rejected', 'Completed'] as const).map(item =>
          <button type="button" role="tab" aria-selected={tab === item} key={item} onClick={() => setTab(item)}>{item}{data?.recordsHidden ? '' : ` (${counts[item]})`}</button>)}
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      <div className={styles.tableWrap}>
        <table>
          <thead><tr><th>Member</th><th>Phone</th><th>Bank / Wallet</th><th>Account Number</th><th>Amount</th><th>Date Requested</th><th>Action</th></tr></thead>
          <tbody>{!data?.recordsHidden && visible.map(item => <tr key={item.id}>
            <td>{item.member.name ?? item.destination_snapshot?.name ?? `Member ${item.user_id.slice(0, 8)}`}</td>
            <td>{item.member.phone ?? '—'}</td>
            <td>{paymentMethod(item.method)}</td>
            <td>{item.destination_snapshot?.number ?? 'Unavailable'}</td>
            <td>{currency(item.amount)}</td>
            <td>{dateTime(item.created_at)}</td>
            <td><button type="button" className={styles.viewButton} onClick={() => { setError(''); setNotice(''); setProof(null); setConfirm(false); setSelectedId(item.id); }}>View Details</button></td>
          </tr>)}
          {(!visible.length || data?.recordsHidden) && <tr><td colSpan={7} className={styles.empty}>{loading ? 'Loading withdrawals…' : data?.recordsHidden ? 'Withdrawal records are hidden on this dashboard. Stored records are unchanged.' : `No ${tab.toLowerCase()} withdrawals.`}</td></tr>}</tbody>
        </table>
      </div>
    </section>

    {!data?.recordsHidden && selected && <div className={styles.overlay} onMouseDown={event => { if (event.target === event.currentTarget) closeDetails(); }}>
      <aside className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="withdrawal-details-title">
        <header className={styles.drawerHeader}><h2 id="withdrawal-details-title">Withdrawal Details</h2><button type="button" aria-label="Close withdrawal details" onClick={closeDetails}><X size={19} /></button></header>
        <div className={styles.drawerBody}>
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

          {selected.status === 'processing' && !selected.hasPayoutProof && <section className={styles.confirmCard}>
            <h3>Confirm Manual Payout</h3>
            <p>Only confirm after independently checking the successful transfer in the official bank or e-wallet transaction history. A screenshot alone is not proof of settlement.</p>
            {!data?.canConfirmPayout && <p className={styles.lockNotice}><ShieldAlert size={16} /> Payout completion is locked pending independently verified authorization.</p>}
            <label className={styles.uploadLabel} htmlFor="payout-proof">Upload Payment Screenshot <span>*</span></label>
            <input id="payout-proof" className={styles.fileInput} type="file" accept="image/png,image/jpeg,.jpg,.jpeg" onChange={event => chooseProof(event.target.files?.[0])} disabled={busy} />
            {previewUrl ? <div className={styles.previewWrap}><Image src={previewUrl} alt="Selected payout screenshot preview" width={640} height={420} unoptimized /><div><span>{proof?.name}</span><button type="button" onClick={() => setProof(null)} disabled={busy}>Remove</button><label htmlFor="payout-proof">Replace</label></div></div>
              : <label className={styles.dropzone} htmlFor="payout-proof"><ImagePlus size={27} /><strong>Upload proof of payment</strong><small>PNG, JPG, or JPEG (Max 5 MB)</small></label>}
            <label className={styles.checkbox}><input type="checkbox" checked={confirm} onChange={event => setConfirm(event.target.checked)} disabled={busy} /><span>I confirm that the money has been sent successfully and verified in the official account history.</span></label>
            <div className={styles.drawerActions}><button type="button" className={styles.cancelButton} onClick={closeDetails} disabled={busy}>Cancel</button><button type="button" className={styles.approveButton} onClick={() => void confirmPayout()} disabled={busy || !proof || !confirm || !data?.canConfirmPayout}><Check size={16} />{busy ? 'Recording…' : 'Approve Withdrawal'}</button></div>
          </section>}
          {selected.status === 'reserved' && <p className={styles.lockNotice}><ShieldAlert size={16} /> This request is awaiting admin review. It must be independently approved and claimed for manual processing before payout confirmation.</p>}
          {selected.status === 'approved' && <p className={styles.lockNotice}><ShieldAlert size={16} /> Approved for processing; confirm the transfer only after it has been sent and the status moves to processing.</p>}
        </div>
      </aside>
    </div>}
  </section>;
}
