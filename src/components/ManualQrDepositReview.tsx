'use client';

import { useState } from 'react';
import { moneyRequest } from '@/lib/money-client';

export default function ManualQrDepositReview({ id, onVerified }: { id: string; onVerified: () => void }) {
  const [proof, setProof] = useState<{ instapay_reference: string; receipt: string;treasuryEnabled?:boolean } | null>(null);
  const [receivedAt,setReceivedAt]=useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [reason, setReason] = useState('');
  const gcash = proof?.instapay_reference.startsWith('GCASH-') ?? false;
  const palawan = proof?.instapay_reference.startsWith('PALAWAN-') ?? false;
  const receivingAccount = palawan ? 'PalawanPay' : gcash ? 'GCash' : null;

  async function reject() {
    if (busy || !window.confirm('Reject this deposit without adding wallet credit?')) return;
    setBusy(true);
    try {
      const result = await moneyRequest('/api/payments/deposit/manual?action=reject', { id, reason });
      setMessage(result.message);
      onVerified();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to reject deposit.'); }
    finally { setBusy(false); }
  }

  async function review(verify: boolean) {
    if (busy) return;
    if (verify && !receivingAccount) {
      setMessage('This deposit does not identify a supported receiving account.');
      return;
    }
    if (verify && receivingAccount && !window.confirm(`I independently verified this payment in the receiving ${receivingAccount} account. Approve and credit this member's Deposit Balance?`)) return;
    setBusy(true);
    setMessage('');
    try {
      const endpoint = '/api/payments/deposit/manual';
      if (verify) {
        const reference = paymentReference.trim();
        const result = await moneyRequest(`${endpoint}?action=verify`,
          palawan ? { id, palawanReference: reference.toUpperCase(),receivedAt:receivedAt?new Date(receivedAt).toISOString():undefined }
            : { id, gcashReference: reference.toUpperCase() });
        setMessage(result.message);
        onVerified();
      } else {
        setProof(await moneyRequest(`${endpoint}?id=${encodeURIComponent(id)}`));
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to review this deposit.');
    } finally { setBusy(false); }
  }

  return <div className="space-y-2 rounded-lg border border-slate-600 p-3">
    <button type="button" disabled={busy} className="text-cyan-200" onClick={() => void review(false)}>View manual deposit receipt</button>
    {proof && <>
      <p>{/^PALAWAN-REQUEST-[A-F0-9]{64}$/.test(proof.instapay_reference)
        ? 'Screenshot-only deposit'
        : `${receivingAccount} reference · ${proof.instapay_reference.slice(palawan ? 8 : 6)}`}</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="max-h-80 max-w-full object-contain" src={proof.receipt} alt="Member deposit receipt" />
      {receivingAccount && <p>Match the amount and reference in your {receivingAccount} transaction history before approving.</p>}
      <label className="block">Reference from your {receivingAccount} transaction history
        <input className="block w-full rounded-lg bg-slate-900 p-2" value={paymentReference}
          onChange={event => setPaymentReference(event.target.value)} />
      </label>
      {palawan && proof.treasuryEnabled && <label className="block">Actual received time from PalawanPay history<input type="datetime-local" className="block w-full rounded-lg border p-2" value={receivedAt} onChange={event=>setReceivedAt(event.target.value)}/><small>Payments received before the latest account snapshot are already included in its cash balance.</small></label>}
      <button type="button" disabled={busy || (palawan && proof.treasuryEnabled && !receivedAt) || !/^[A-Z0-9-]{5,74}$/i.test(paymentReference.trim()) || (palawan && paymentReference.trim().length > 72)}
        className="rounded-lg bg-purple-800 p-2 disabled:opacity-40" onClick={() => void review(true)}>
        {`Approve received ${receivingAccount} payment`}
      </button>
      {palawan && <div className="space-y-2"><label className="block">Rejection reason
        <input className="block w-full rounded-lg border p-2" value={reason} maxLength={500} onChange={event=>setReason(event.target.value)} />
      </label><button type="button" disabled={busy || reason.trim().length<5} className="rounded-lg border p-2 disabled:opacity-40" onClick={()=>void reject()}>Reject deposit</button></div>}
    </>}
    {message && <p role="status">{message}</p>}
  </div>;
}
