'use client';
import { useCallback, useEffect, useState } from 'react';
import { moneyRequest } from '@/lib/money-client';

type Readiness = {
  automatedPaymentsAvailable: false;
  productionPaymentsAuthorized: false;
  message: string;
};

export default function MoneyReadiness() {
  const [data, setData] = useState<Readiness | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    setBusy(true);
    setError('');
    try { setData(await moneyRequest('/api/admin/money/readiness')); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load payment status'); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  return <section className="space-y-3 rounded-xl border border-slate-700 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-xl font-semibold">Payment processing</h2>
      <button type="button" disabled={busy} onClick={() => void refresh()} className="rounded-lg bg-slate-700 px-4 py-2 disabled:opacity-50">
        {busy ? 'Refreshing…' : 'Refresh status'}
      </button>
    </div>
    {error && <p role="alert" className="text-red-300">{error}</p>}
    {data && <p className="text-amber-200">{data.message}</p>}
  </section>;
}
