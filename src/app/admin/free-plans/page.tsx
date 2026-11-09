'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Gift, RefreshCw } from 'lucide-react';
import { moneyRequest } from '@/lib/money-client';
import { memberMatchesSearch } from '@/lib/member-search';
import MoneyAdminMFA from '@/components/MoneyAdminMFA';
import { productDetails } from '@/lib/product-presentation';

type Member = { id: string; phone: string | null; role: string; created_at: string | null };
type Product = { id: string; name: string; price: number; daily_income: number };
type Grant = { id: string; user_id: string; product_id: string; created_at: string; note: string; mode: string };
type InvitePage = {
  recipientDeposited: boolean;
  members: { id: string; phoneLast4: string | null; deposited: boolean }[];
  total: number;
  hasMore: boolean;
};
const peso = (value: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(value);

function GrantInvites({ grantId }: { grantId: string }) {
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

export default function FreePlansPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [search, setSearch] = useState('');
  const [userId, setUserId] = useState('');
  const [productId, setProductId] = useState('');
  const [note, setNote] = useState('Welcome to AUREVIA');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const key = useRef<string | null>(null);
  const lock = useRef(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [users, plans] = await Promise.all([moneyRequest('/api/admin/users'), moneyRequest('/api/admin/free-plans')]);
      setMembers((users.members as Member[]).filter(member => member.role === 'user'));
      setProducts(plans.products); setGrants(plans.grants);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load free plans.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const member = members.find(item => item.id === userId);
  const tiers = products.flatMap(item => {
    const details = productDetails(item.name);
    return details ? [{ ...item, tier: details.tier }] : [];
  }).sort((a, b) => a.tier - b.tier);
  const product = tiers.find(item => item.id === productId);
  const received = new Set(grants.filter(grant => grant.mode === 'funded').map(grant => grant.user_id));
  const filtered = members.filter(item => memberMatchesSearch(item, search) || item.id === userId);
  async function grantPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    if (!member) { setError('Select a member from the Member dropdown. The search box only filters the list.'); return; }
    if (!product) { setError('Select a tier before granting the free plan.'); return; }
    if (received.has(userId)) { setError('This member already received a free welcome plan. Select another member.'); return; }
    lock.current = true; setBusy(true); setError(''); setMessage('');
    try {
      key.current ??= crypto.randomUUID();
      const result = await moneyRequest('/api/admin/free-plans', { userId, productId, note, key: key.current });
      setMessage(result.message); key.current = null; setUserId('');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to grant free plan.'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <main className="min-h-screen bg-[#0b1320] p-5 text-white"><div className="mx-auto max-w-4xl space-y-6">
    <Link href="/admin" className="inline-flex items-center gap-2 text-cyan-300"><ArrowLeft size={18} />Back to Admin</Link>
    <header className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="flex items-center gap-3 text-2xl font-bold"><Gift className="text-cyan-300" />Free Welcome Plan</h1><p className="mt-2 text-slate-300">Grant a funded tier with automatic wallet rewards. Admin MFA is required.</p></div><button type="button" onClick={() => { setError(''); void load(); }} disabled={loading || busy} className="flex items-center gap-2 rounded-xl border border-slate-600 px-4 py-3 disabled:opacity-50"><RefreshCw size={16} />Refresh</button></header>
    <MoneyAdminMFA onVerified={() => setError('')} />
    {error && <p role="alert" className="rounded-xl border border-red-700 bg-red-950 p-4 text-red-200">{error}</p>}
    {message && <p role="status" className="rounded-xl border border-emerald-700 bg-emerald-950 p-4 text-emerald-200">{message}</p>}
    <form onSubmit={grantPlan} className="space-y-5 rounded-2xl border border-slate-700 bg-[#10243b] p-6">
      <fieldset disabled={loading || busy} className="space-y-5 disabled:opacity-60">
        <div><label htmlFor="free-member-search" className="mb-2 block font-semibold">Find a member</label><input id="free-member-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search by mobile number or user ID" className="w-full rounded-xl border border-slate-600 bg-slate-950 p-3 text-white" /><p className="mt-2 text-sm text-slate-300">After searching, choose the account in the Member dropdown below.</p></div>
        <div><label htmlFor="free-member" className="mb-2 block font-semibold">Member</label><select id="free-member" required value={userId} onInvalid={() => setError('Choose an account from the Member dropdown.')} onChange={event => { setUserId(event.target.value); setError(''); key.current = null; }} className="w-full rounded-xl border border-slate-600 bg-slate-950 p-3 text-white"><option value="">Select a member</option>{filtered.map(item => <option key={item.id} value={item.id} disabled={received.has(item.id)}>{item.phone ?? item.id.slice(0, 8)}{received.has(item.id) ? ' · Free plan already granted' : ''}</option>)}</select>{!loading && filtered.length === 0 && <p className="mt-2 text-sm text-amber-200">No matching members. Check the number or clear your search.</p>}</div>
        <div><label htmlFor="free-product" className="mb-2 block font-semibold">Tier</label><select id="free-product" required value={productId} onInvalid={() => setError('Choose a tier from the dropdown.')} onChange={event => { setProductId(event.target.value); setError(''); key.current = null; }} className="w-full rounded-xl border border-slate-600 bg-slate-950 p-3 text-white"><option value="">Select a tier</option>{tiers.map(item => <option key={item.id} value={item.id}>Tier {item.tier} · {peso(Number(item.price))}</option>)}</select></div>
        <div><label htmlFor="free-note" className="mb-2 block font-semibold">Admin note</label><input id="free-note" value={note} maxLength={300} onChange={event => { setNote(event.target.value); key.current = null; }} className="w-full rounded-xl border border-slate-600 bg-slate-950 p-3 text-white" /></div>
        {member && product && <div className="space-y-2 rounded-xl border border-cyan-800 bg-cyan-950 p-4"><p>{member.phone ?? member.id.slice(0, 8)} · Tier {product.tier}</p><p className="text-xl font-bold text-cyan-200">Free · No balance deduction</p><p className="text-sm text-slate-200">Daily reward {peso(Number(product.daily_income))}. Rewards are reserved from the business budget and credited automatically after they become eligible.</p></div>}
        <p id="free-plan-selection-help" role="status" className="text-sm text-cyan-100">{!member ? 'Step 1: Select the recipient in the Member dropdown.' : !product ? 'Step 2: Select the tier to give for free.' : received.has(userId) ? 'This member already received a free welcome plan. Select another member.' : 'Ready. Review the member and tier above, then grant the free plan.'}</p>
        <button type="submit" disabled={loading || busy} aria-describedby="free-plan-selection-help" className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-cyan-400 p-4 font-bold text-slate-950 disabled:cursor-wait disabled:opacity-50"><Gift size={20} />{busy ? 'Granting…' : loading ? 'Loading…' : 'Grant Free Plan'}</button>
      </fieldset>
      <p className="text-sm text-slate-300">One funded welcome plan per member. The business budget must cover the entire reward term.</p>
    </form>
    <section className="rounded-2xl border border-slate-700 bg-[#10243b] p-6"><h2 className="mb-4 text-lg font-semibold">Recent free plan grants</h2>{loading ? <p role="status">Loading…</p> : grants.length === 0 ? <p className="text-slate-300">No free plans granted yet.</p> : <div className="space-y-4">{grants.map(grant => <article key={grant.id} className="border-b border-slate-700 pb-4"><strong>{members.find(item => item.id === grant.user_id)?.phone ?? grant.user_id.slice(0, 8)}</strong><p>{products.find(item => item.id === grant.product_id)?.name ?? 'Investment product'} · {grant.mode === 'funded' ? 'Funded free plan' : 'Test free plan'}</p><p className="text-sm text-slate-300">{new Date(grant.created_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}</p>{grant.note && <p className="mt-1 break-words text-sm text-slate-300">{grant.note}</p>}<GrantInvites grantId={grant.id} /></article>)}</div>}</section>
  </div></main>;
}
