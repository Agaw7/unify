'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { moneyRequest } from '@/lib/money-client';

export default function GiftCodesPage() {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await moneyRequest('/api/rewards', { action: 'create' });
      setCode(result.code);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to create code.');
    } finally { setBusy(false); }
  }
  return <main className="member-profile member-profile-detail">
    <Link href="/admin/money">← Money operations</Link>
    <h2>Gift Codes</h2>
    <form onSubmit={create}>
      <p>Each code is available to 50 members, with one redemption per member. Most rewards are ₱1–₱5, with a 5% chance of ₱6–₱10.</p>
      <button type="submit" className="invest-now-button" disabled={busy}>{busy ? 'Creating…' : 'Create code'}</button>
      {code && <p role="status">Gift code <code>{code}</code></p>}
      {error && <p role="alert">{error}</p>}
    </form>
  </main>;
}
