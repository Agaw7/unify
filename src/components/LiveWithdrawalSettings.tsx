'use client';
import { useEffect, useRef, useState } from 'react';
import { moneyRequest } from '@/lib/money-client';

export default function LiveWithdrawalSettings() {
  const [saved, setSaved] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const lock = useRef(false);

  async function load() {
    try { setSaved((await moneyRequest('/api/admin/money/settings')).withdrawal_mode); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load withdrawal mode'); }
  }
  useEffect(() => { void load(); }, []);

  async function enforceManualReview() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await moneyRequest('/api/admin/money/settings', { mode: 'admin_approval', reason });
      await load();
      setReason('');
      setNotice('Admin Approval mode is active. Transfers must be completed and recorded manually.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update withdrawal mode');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return <section className="space-y-4 rounded-xl border border-slate-700 p-5 text-white">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-xl font-semibold">Withdrawal processing</h2>
      <span className="rounded-full bg-cyan-950 px-3 py-1 text-sm text-cyan-200">
        Active: {saved === 'admin_approval' ? 'Admin Approval' : saved ?? 'Loading…'}
      </span>
    </div>
    <p className="text-sm text-slate-300">Automated transfers are unavailable. Withdrawals must be reviewed by an administrator, then completed through an approved manual channel.</p>
    {error && <p role="alert" className="text-red-200">{error}</p>}
    {notice && <p role="status" className="text-cyan-200">{notice}</p>}
    {saved !== 'admin_approval' && <>
      <label className="block">Reason for switching to Admin Approval<textarea className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 p-3" value={reason} onChange={event => setReason(event.target.value)} maxLength={500} disabled={busy}/></label>
      <button type="button" className="rounded-lg bg-cyan-400 px-4 py-3 font-semibold text-slate-950 disabled:opacity-40" disabled={busy || reason.trim().length < 5} onClick={() => void enforceManualReview()}>
        {busy ? 'Saving…' : 'Set Admin Approval mode'}
      </button>
    </>}
  </section>;
}
