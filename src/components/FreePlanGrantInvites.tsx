'use client';

import { useState } from 'react';
import { moneyRequest } from '@/lib/money-client';

type InvitePage = {
  recipientDeposited: boolean;
  members: { id: string; phoneLast4: string | null; deposited: boolean }[];
  total: number;
  hasMore: boolean;
};

export default function GrantInvites({ grantId }: { grantId: string }) {
  const [details, setDetails] = useState<InvitePage | null>(null);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function loadInvites(nextPage: number) {
    setBusy(true);
    setError('');
    try {
      const result = await moneyRequest(`/api/admin/free-plans?grant=${grantId}&page=${nextPage}`);
      setDetails(result);
      setPage(nextPage);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load invites.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="mt-3 space-y-2 text-sm">
    <button type="button" disabled={busy} aria-expanded={details !== null}
      className="rounded-lg border border-slate-600 px-3 py-2"
      onClick={() => { if (details) { setDetails(null); setError(''); } else void loadInvites(0); }}>
      {details ? 'Hide invites and deposits' : 'View invites and deposits'}
    </button>
    {busy && <p role="status">Loading deposit activity…</p>}
    {error && <p role="alert">{error}</p>}
    {details && <div className="space-y-2">
      <p>Free plan recipient · {details.recipientDeposited ? 'Completed live deposit' : 'No completed live deposit'}</p>
      <p className="font-semibold">Direct invites ({details.total})</p>
      {details.total === 0 && <p>No direct invites yet.</p>}
      <ul className="divide-y divide-slate-700">
        {details.members.map(invite => <li key={invite.id} className="flex flex-wrap justify-between gap-x-4 py-2">
          <span>{invite.phoneLast4 ? `•••• ${invite.phoneLast4}` : `Member ${invite.id.slice(0, 8)}`}</span>
          <span>{invite.deposited ? 'Completed live deposit' : 'No completed live deposit'}</span>
        </li>)}
      </ul>
      {(page > 0 || details.hasMore) && <div className="flex flex-wrap gap-3">
        {page > 0 && <button type="button" className="underline" disabled={busy} onClick={() => void loadInvites(page - 1)}>Previous invites</button>}
        {details.hasMore && <button type="button" className="underline" disabled={busy} onClick={() => void loadInvites(page + 1)}>Next invites</button>}
      </div>}
    </div>}
  </div>;
}


