'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { moneyRequest } from '@/lib/money-client';
import MoneyAdminMFA from '@/components/MoneyAdminMFA';

type Account = { id: 'palawan' | 'gotyme'; balance: number; reconciled_at: string | null; reference: string | null };
type CashSummary = { ready: boolean; cash: number; unallocated: number; shortfall: number; accounts: Account[] };
type State = {
  budget: { available: number; reserved: number; sales: number; funded: number };
  funding: { id: string; amount: number; reference: string; created_at: string }[];
  cashSummary: CashSummary | null;
  fundingEnabled: boolean;
};

const php = (cents: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(cents) / 100);
const field = 'mt-2 block w-full min-w-0 rounded-xl border border-slate-600 bg-slate-900 p-3';
const button = 'rounded-xl bg-cyan-400 px-5 py-3 font-semibold text-slate-950 disabled:opacity-40';
const accountName = (id: string) => id === 'palawan' ? 'PalawanPay' : 'GoTyme Bank';
function localNow() {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
}

export default function BusinessBudget() {
  const [data, setData] = useState<State | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState<'palawan' | 'gotyme'>('palawan');
  const [amount, setAmount] = useState('');
  const [at, setAt] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const lock = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await moneyRequest('/api/admin/business-budget'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load recorded reward budget.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setAt(localNow());
    void load();
  }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || !data?.cashSummary?.ready || !confirmed) return;
    const numericAmount = Number(amount);
    const details = `Record that ${php(Math.round(numericAmount * 100))} has already arrived in ${accountName(account)} and allocate it to the rewards budget? This records accounting entries only; it does not initiate a bank transfer.`;
    if (!window.confirm(details)) return;

    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const body = { account, amount: numericAmount, at: new Date(at).toISOString(), confirmed: true };
      const fingerprint = JSON.stringify(body);
      const saved = sessionStorage.getItem('aurevia-reward-budget-deposit');
      let pending: { fingerprint: string; key: string } | null = saved ? JSON.parse(saved) : null;
      if (!pending || pending.fingerprint !== fingerprint) pending = { fingerprint, key: crypto.randomUUID() };
      sessionStorage.setItem('aurevia-reward-budget-deposit', JSON.stringify(pending));
      const result = await moneyRequest('/api/admin/business-budget', { ...body, key: pending.key });
      sessionStorage.removeItem('aurevia-reward-budget-deposit');
      setNotice(result.alreadyRecorded ? 'This deposit was already recorded.' : 'Verified deposit recorded and allocated to the rewards budget.');
      setAmount('');
      setConfirmed(false);
      setAt(localNow());
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Reward funding could not be confirmed. Refresh before retrying.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  const cash = data?.cashSummary;
  const amountValue = Number(amount);
  const validAmount = Number.isFinite(amountValue) && amountValue >= 100 && amountValue <= 1000000;
  const canSubmit = Boolean(data?.fundingEnabled && cash?.ready && Number(cash.shortfall) === 0)
    && validAmount && Boolean(at) && confirmed && !busy;

  return <main className="min-h-screen bg-[#0b1320] p-5 text-white">
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/admin" className="text-cyan-300">← Administration</Link>
      <header>
        <h1 className="text-3xl font-semibold">Reward Budget</h1>
        <p className="mt-2 text-slate-300">Record your verified business-fund deposit and allocate it to member rewards.</p>
      </header>
      <p className="rounded-xl border border-amber-700 bg-amber-950/40 p-4 text-amber-100">
        Record only business funds that have already arrived in the selected account and that you have independently verified in its transaction history. The automatic reference is for internal tracking only; it does not verify the deposit or initiate a transfer. Never use member deposits or reserved funds as rewards funding.
      </p>
      {error && <p role="alert" className="rounded-xl bg-red-950 p-4 text-red-200">{error}</p>}
      {notice && <p role="status" className="rounded-xl bg-emerald-950 p-4 text-emerald-200">{notice}</p>}
      <div className="flex flex-wrap gap-3">
        <button type="button" className={button} disabled={loading || busy} onClick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh budget'}</button>
        <Link href="/admin/treasury" className="rounded-xl border border-slate-600 px-5 py-3">Cash account records</Link>
      </div>
      {data && <>
        <section className="grid gap-4 sm:grid-cols-2">
          {[
            ['Available reward funds', data.budget.available],
            ['Reserved reward funds', data.budget.reserved],
            ['Product receipts (not available to rewards)', data.budget.sales],
            ['Total recorded funding', data.budget.funded],
          ].map(([title, value]) => <article className="rounded-xl border border-slate-700 bg-[#10243b] p-5" key={String(title)}>
            <p className="text-slate-300">{title}</p>
            <p className="mt-2 text-2xl font-semibold">{php(Number(value))}</p>
          </article>)}
        </section>

        <MoneyAdminMFA onVerified={() => void load()} />
        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-700 bg-[#10243b] p-5">
          <h2 className="text-xl font-semibold">Record a deposit to Reward Budget</h2>
          {!data.fundingEnabled && <p role="alert" className="rounded-lg bg-amber-950 p-3 text-amber-100">Enable manual cash-account tracking and apply the treasury migrations before recording funding.</p>}
          {cash?.ready && Number(cash.shortfall) > 0 && <p role="alert" className="rounded-lg bg-red-950 p-3 text-red-200">A recorded cash shortfall must be reconciled before rewards can be funded.</p>}
          {!cash?.ready && data.fundingEnabled && <p className="rounded-lg bg-amber-950 p-3 text-amber-100">Confirm the PalawanPay and GoTyme opening balances in Cash Account Records first.</p>}
          <label className="block">Business account
            <select className={field} value={account} onChange={event => setAccount(event.target.value === 'gotyme' ? 'gotyme' : 'palawan')} disabled={busy}>
              <option value="palawan">PalawanPay</option>
              <option value="gotyme">GoTyme Bank</option>
            </select>
          </label>
          <label className="block">Deposit amount (PHP)
            <input className={field} type="number" min="100" max="1000000" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} required disabled={busy} />
          </label>
          <label className="block">Actual deposit date and time
            <input className={field} type="datetime-local" step="1" value={at} onChange={event => setAt(event.target.value)} required disabled={busy} />
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={busy} />
            <span>I independently verified this business deposit in the selected account’s transaction history, confirmed it has arrived, and confirmed it has not been recorded before.</span>
          </label>
          <button type="submit" className={button} disabled={!canSubmit}>{busy ? 'Recording…' : 'Record deposit to Reward Budget'}</button>
          {cash && <p className="text-sm text-slate-300">Recorded unallocated business cash: {php(Number(cash.unallocated))}. Your deposit is added to the account record and allocated to reward funds in one atomic entry.</p>}
        </form>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Recorded reward funding history</h2>
          {data.funding.length === 0 && <p>No business funding recorded.</p>}
          {data.funding.map(item => <article key={item.id} className="break-words rounded-lg bg-slate-900 p-4">
            <strong>{php(item.amount)}</strong>
            <p>{item.reference} · {new Date(item.created_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}</p>
          </article>)}
        </section>
      </>}
    </div>
  </main>;
}
