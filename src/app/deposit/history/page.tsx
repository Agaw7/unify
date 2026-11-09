'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowDownToLine, ArrowUpFromLine, RefreshCw } from 'lucide-react';
import { moneyRequest } from '@/lib/money-client';

type Entry = { id: string; amount: number; status: string; method: string | null; destination: string | null; created_at: string };
type History = { entries: Entry[]; total: number; page: number; pageSize: number };
const peso = (value: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(value);

export default function DepositHistoryPage() {
  const [kind, setKind] = useState('deposit');
  const withdrawals = kind === 'withdrawal';
  const label = withdrawals ? 'withdrawals' : 'deposits';
  const [page, setPage] = useState(1);
  const [data, setData] = useState<History | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const requestVersion = useRef(0);
  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setBusy(true); setError('');
    try {
      const result = await moneyRequest(`/api/payments/history?kind=${kind}&page=${page}`);
      if (version === requestVersion.current) setData(result);
    }
    catch (e) { if (version === requestVersion.current) { setData(null); setError(e instanceof Error ? e.message : 'Unable to load payment history.'); } }
    finally { if (version === requestVersion.current) setBusy(false); }
  }, [kind, page]);
  useEffect(() => { void load(); }, [load]);
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / 25));
  return <main className="min-h-screen bg-[#0b1320] p-5 text-white"><div className="mx-auto max-w-3xl space-y-5">
    <header className="flex items-center justify-between gap-3"><Link href="/dashboard" className="flex items-center gap-2 text-cyan-300"><ArrowLeft size={19} />Back</Link><h1 className="text-xl font-bold">{withdrawals ? 'Withdrawal History' : 'Deposit History'}</h1><button type="button" aria-label="Refresh payment history" disabled={busy} onClick={() => void load()} className="p-2 text-cyan-300 disabled:opacity-40"><RefreshCw size={19} /></button></header>
    <div className="flex flex-wrap gap-2" aria-label="Payment history filters">{[['deposit', 'PHP deposits'], ['withdrawal', 'PHP withdrawals']].map(([type, title]) => <button key={type} type="button" disabled={busy} aria-pressed={kind === type} onClick={() => { setData(null); setKind(type); setPage(1); }} className={`rounded-xl border px-4 py-2 text-sm ${kind === type ? 'border-cyan-400 bg-cyan-950 text-cyan-200' : 'border-slate-700 bg-slate-900 text-slate-300'}`}>{title}</button>)}</div>
    <p className="text-sm text-slate-400">{withdrawals ? 'PHP withdrawal requests and payout statuses.' : 'PHP deposits; paid funds may remain held for settlement.'} All statuses are included, newest first.</p>
    {error && <p role="alert" className="rounded-xl border border-red-900 bg-red-950 p-4 text-red-200">{error} <Link href="/login" className="underline">Sign in</Link></p>}
    {busy ? <p role="status" className="py-8 text-center text-slate-400">Loading {label}…</p> : data && <>
      <div className="overflow-hidden rounded-2xl border border-slate-700 bg-[#0d1b2d]">
        {data.entries.length === 0 ? <div className="space-y-3 p-10 text-center text-slate-400"><div className="flex justify-center text-cyan-400">{withdrawals ? <ArrowUpFromLine /> : <ArrowDownToLine />}</div><p>No {label} yet.</p></div> : data.entries.map(entry => <article key={entry.id} className="flex items-start justify-between gap-4 border-b border-slate-700 p-5 last:border-0"><div className="min-w-0 space-y-2"><h2 className="font-semibold">{withdrawals ? 'Withdrawal' : 'Deposit'}{entry.method ? ` · ${entry.method === 'maya' ? 'Maya' : entry.method.toUpperCase()}` : ''}</h2><p className="text-xs text-slate-400">{new Date(entry.created_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })} · <span className="capitalize">{entry.status.replaceAll('_', ' ')}</span></p><p className="break-all text-xs text-slate-500">{entry.id}</p>{entry.destination && <p className="text-xs text-slate-400">Recipient: {entry.destination}</p>}</div><strong className={`shrink-0 ${withdrawals ? 'text-sky-300' : 'text-emerald-400'}`}>{withdrawals ? '−' : '+'}{peso(entry.amount)}</strong></article>)}
      </div>
      <nav aria-label="Payment history pages" className="flex items-center justify-between gap-3 text-sm"><button type="button" disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="rounded-lg border border-slate-700 px-3 py-2 text-cyan-300 disabled:opacity-30">Previous</button><span className="text-center text-slate-400">Page {page} of {pages} · {data.total} {label}</span><button type="button" disabled={page >= pages} onClick={() => setPage(p => p + 1)} className="rounded-lg border border-slate-700 px-3 py-2 text-cyan-300 disabled:opacity-30">Next</button></nav>
    </>}
  </div></main>;
}
