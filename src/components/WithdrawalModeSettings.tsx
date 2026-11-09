'use client';
import { useCallback, useEffect, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { moneyRequest } from '@/lib/money-client';

type Mode = 'automatic' | 'admin_approval';
type Settings = { mode: Mode; version: number; updated_at: string };
type Audit = { id: string; previous_mode: Mode; new_mode: Mode; actor_id: string; created_at: string };
const label = (mode: Mode) => mode === 'automatic' ? 'Automatic Withdrawal' : 'Admin Approval';

export default function WithdrawalModeSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [mode, setMode] = useState<Mode>('admin_approval');
  const [automaticAvailable, setAutomaticAvailable] = useState(false);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const result = await moneyRequest('/api/admin/withdrawal-settings');
      setSettings(result.settings); setMode(result.settings.mode);
      setAutomaticAvailable(result.automaticAvailable); setAudit(result.audit ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load settings.'); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function save() {
    if (busy || !settings) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await moneyRequest('/api/admin/withdrawal-settings', { mode, version: settings.version });
      setSettings(result.settings); setMessage(result.message);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save settings.'); }
    finally { setBusy(false); }
  }
  return <section className="mt-6 space-y-4 rounded-2xl border border-slate-600 bg-[#10243b] p-6 text-white">
    <h2 className="flex items-center gap-2 text-xl font-semibold"><Settings2 className="text-cyan-300" />Withdrawal Settings <span className="rounded-full bg-cyan-950 px-3 py-1 text-xs text-cyan-200">Test Mode</span></h2>
    <p className="text-sm text-slate-300">Choose how new simulated withdrawal requests are processed. Existing requests keep their original mode and status.</p>
    <fieldset disabled={busy || !settings} className="space-y-3">
      <legend className="sr-only">Withdrawal processing mode</legend>
      {(['automatic', 'admin_approval'] as const).map(value => <label key={value} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${mode === value ? 'border-cyan-400 bg-cyan-950' : 'border-slate-600 bg-slate-900'}`}>
        <input type="radio" name="withdrawal-mode" checked={mode === value} disabled={value === 'automatic' && !automaticAvailable} onChange={() => { setMode(value); setMessage(''); }} className="mt-1 accent-cyan-400" />
        <span><strong>{label(value)}</strong><span className="mt-1 block text-sm text-slate-300">{value === 'automatic' ? 'Eligible requests are marked simulated paid automatically. No real transfer occurs.' : 'New requests reserve the balance and wait for administrator approval.'}</span></span>
      </label>)}
    </fieldset>
    {settings && <p className="font-semibold text-cyan-200">Current mode: {label(settings.mode)}</p>}
    {!busy && !automaticAvailable && <p className="text-sm text-amber-200">Automatic simulation is disabled in server configuration. Admin Approval remains available.</p>}
    {error && <p role="alert" className="text-red-300">{error}</p>}
    {message && <p role="status" className="text-emerald-300">{message}</p>}
    <div className="flex flex-wrap gap-3"><button type="button" disabled={busy || !settings || mode === settings.mode} onClick={() => void save()} className="rounded-xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 disabled:opacity-50">{busy ? 'Loading…' : 'Save Withdrawal Mode'}</button><button type="button" disabled={busy} onClick={() => void load()} className="rounded-xl border border-slate-500 px-5 py-3 disabled:opacity-50">Refresh Settings</button></div>
    {audit.length > 0 && <details className="text-sm text-slate-300"><summary className="cursor-pointer">Recent mode changes</summary><ul className="mt-3 space-y-2">{audit.map(item => <li key={item.id}>{label(item.previous_mode)} → {label(item.new_mode)} · {new Date(item.created_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })} · Admin {item.actor_id.slice(0, 8)}</li>)}</ul></details>}
  </section>;
}
