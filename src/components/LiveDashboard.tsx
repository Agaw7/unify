'use client';

import { formatPhp } from '@/lib/format-php';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Banknote,
  Eye,
  EyeOff,
  History,
  Home,
  Layers3,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Sprout,
  Store,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { moneyRequest } from '@/lib/money-client';
import HomeRewards from '@/components/HomeRewards';
import LiveInvestments from '@/components/LiveInvestments';
import TeamDashboard from '@/components/TeamDashboard';

type DashboardTab = 'home' | 'tier' | 'market' | 'friends' | 'profile';

type WalletState = {
  wallet: { available: number; deposit_available: number; held: number; reserved: number; debt: number };
  transactions: { id: string; kind: string; amount: number; status: string; created_at: string }[];
  totalEarned?: number | null;
};

const php = (cents: number) => formatPhp(Number(cents) / 100);

export default function LiveDashboard() {
  const [data, setData] = useState<WalletState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [phone, setPhone] = useState('');
  const [memberId, setMemberId] = useState('');
  const [showBalance, setShowBalance] = useState(true);
  const [activeTab, setActiveTab] = useState<DashboardTab>('home');

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) {
        window.location.replace('/login');
        return;
      }

      const user = session.session.user;
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();
      if (profileError) throw new Error('Unable to load your account profile.');

      setAdmin(profile?.role === 'admin');
      setPhone(user.phone ?? '');
      setMemberId(user.id);
      setData(await moneyRequest('/api/money?summary=profile'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load wallet');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const refresh = () => void load();
    window.addEventListener('pageshow', refresh);
    return () => window.removeEventListener('pageshow', refresh);
  }, [load]);

  async function logout() {
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      setError('Unable to sign out. Please try again.');
      return;
    }
    window.location.replace('/login');
  }

  const wallet = data?.wallet;
  const transactions = data?.transactions ?? [];
  const totalBalance = wallet ? Number(wallet.available) + Number(wallet.deposit_available) : null;
  const money = (amount: number | null) => amount === null ? '—' : showBalance ? php(amount) : '••••••';

  return (
    <main className="min-h-screen bg-[#fcf8fd] text-[#48204f]">
      <div className="mx-auto min-h-screen max-w-[1100px] px-4 py-5 pb-28 sm:px-7 lg:px-10">
          <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-bold tracking-[0.24em] text-teal-500">AROMEVA MEMBER AREA</p>
              <h1 className="mt-2 text-2xl font-bold text-[#48204f] sm:text-3xl">
                {activeTab === 'home' ? 'Member Dashboard' : activeTab === 'tier' ? 'My Tier' : activeTab === 'market' ? 'Market' : activeTab === 'friends' ? 'Friends' : 'Profile'}
              </h1>
              <p className="mt-1 text-sm text-[#806b87]">{phone || 'Welcome back'}</p>
            </div>
            <div className="flex items-center gap-3">
              {admin && (
                <Link href="/admin" className="inline-flex items-center gap-2 rounded-xl border border-violet-300 px-3 py-2 text-sm text-violet-700">
                  <ShieldCheck size={17} aria-hidden="true" /> Admin
                </Link>
              )}
              <button onClick={() => void load()} disabled={busy} aria-label="Refresh dashboard" className="rounded-xl border border-[#eadff0] bg-white/70 p-3 text-teal-700 disabled:opacity-50">
                <RefreshCw size={18} className={busy ? 'animate-spin' : ''} aria-hidden="true" />
              </button>
              <button onClick={() => void logout()} className="rounded-xl border border-[#eadff0] bg-white/70 p-3 text-[#705a76]" aria-label="Log out">
                <LogOut size={18} aria-hidden="true" />
              </button>
            </div>
          </header>

          {error && <p role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">{error}</p>}

          {activeTab === 'home' && <>
          <section className="rounded-[30px] border border-teal-700/60 bg-gradient-to-br from-[#301844] via-[#42214f] to-[#261432] p-5 text-white shadow-[0_18px_42px_rgba(54,24,64,0.18)] sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold text-violet-100">
                  Total balance
                  <button type="button" onClick={() => setShowBalance(value => !value)} className="rounded-full p-1 text-violet-100 hover:bg-white/10" aria-label={showBalance ? 'Hide balance' : 'Show balance'} aria-pressed={!showBalance}>
                    {showBalance ? <Eye size={18} /> : <EyeOff size={18} />}
                  </button>
                </p>
                <p className="mt-2 break-words text-4xl font-extrabold tracking-tight sm:text-5xl">{money(totalBalance)}</p>
                <p className="mt-3 text-sm text-violet-100">{data ? 'No upcoming earnings' : 'Loading account balance…'}</p>
              </div>
              <p className="rounded-full border border-white/15 bg-white/10 px-3 py-2 text-xs text-violet-100">ID: {memberId ? memberId.slice(0, 8).toUpperCase() : '—'}</p>
            </div>
            <div className="mt-6 grid gap-3 rounded-3xl border border-white/10 bg-white/10 p-4 sm:grid-cols-2 sm:p-5">
              <div>
                <p className="text-sm text-violet-100">Available</p>
                <p className="mt-1 text-xl font-bold">{money(wallet ? Number(wallet.available) : null)}</p>
              </div>
              <div>
                <p className="text-sm text-violet-100">Deposit balance</p>
                <p className="mt-1 text-xl font-bold">{money(wallet ? Number(wallet.deposit_available) : null)}</p>
                <p className="mt-1 text-xs text-violet-100/80">For product purchases</p>
              </div>
            </div>
          </section>

          <section id="quick-actions" className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Quick actions">
            <Link href="/deposit" className="flex min-h-20 items-center justify-center gap-3 rounded-2xl border border-teal-300 bg-teal-700 p-4 text-center font-semibold text-white transition hover:bg-teal-800">
              <ArrowDownToLine size={22} aria-hidden="true" /> Deposit
            </Link>
            <Link href="/withdraw" className="flex min-h-20 items-center justify-center gap-3 rounded-2xl border border-violet-300 bg-violet-400 p-4 text-center font-semibold text-white transition hover:bg-violet-500">
              <ArrowUpFromLine size={22} aria-hidden="true" /> Withdraw
            </Link>
            <button type="button" onClick={() => setActiveTab('market')} className="flex min-h-20 items-center justify-center gap-3 rounded-2xl border border-cyan-300 bg-cyan-700 p-4 text-center font-semibold text-white transition hover:bg-cyan-800">
              <Layers3 size={22} aria-hidden="true" /> Market
            </button>
            <button type="button" onClick={() => setActiveTab('friends')} className="flex min-h-20 items-center justify-center gap-3 rounded-2xl border border-fuchsia-300 bg-fuchsia-500 p-4 text-center font-semibold text-white transition hover:bg-fuchsia-600">
              <UsersRound size={22} aria-hidden="true" /> Friends
            </button>
          </section>

          <div className="mt-5">
            <HomeRewards onTasks={() => window.location.assign('/tasks')} onClaim={() => void load()} />
          </div>

          <section id="recommended-tiers" className="mt-7 rounded-3xl border border-[#eadff0] bg-white/80 p-5 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-[#48204f]">Recommended Tier</h2>
                <p className="mt-1 text-sm text-[#806b87]">Review available plans and your current tier details.</p>
              </div>
              <button type="button" onClick={() => setActiveTab('market')} className="inline-flex items-center gap-2 rounded-full border border-[#eadff0] bg-[#fffaff] px-4 py-2 text-sm font-semibold text-[#54265e]">View All <span aria-hidden="true">›</span></button>
            </div>
            <div className="mt-4 rounded-2xl bg-gradient-to-r from-[#f1e5f6] via-[#f9eaf2] to-[#fff3df] p-4">
              <p className="font-semibold text-[#54265e]">Explore the AROMEVA tier catalog</p>
              <p className="mt-1 text-sm text-[#775d80]">Plan availability and terms are shown in Market. Purchases remain subject to current authorization settings.</p>
              <button type="button" onClick={() => setActiveTab('market')} className="mt-3 inline-flex rounded-xl bg-[#54265e] px-4 py-2 text-sm font-semibold text-white">Explore Market</button>
            </div>
          </section>

          <section className="mt-5 grid gap-3 sm:grid-cols-3">
            {[
              ['Held for settlement', wallet?.held],
              ['Reserved', wallet?.reserved],
              ['Reversal shortfall', wallet?.debt],
            ].map(([label, amount]) => (
              <article key={String(label)} className="rounded-2xl border border-[#897b91] bg-white/70 p-4">
                <p className="text-sm text-[#775d80]">{label}</p>
                <p className="mt-2 text-xl font-bold text-[#48204f]">{money(typeof amount === 'number' ? amount : null)}</p>
              </article>
            ))}
          </section>

          <section id="recent-transactions" className="mt-8">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-xl font-semibold text-[#48204f]"><History size={20} className="text-teal-700" aria-hidden="true" />Recent transactions</h2>
              <Link href="/deposit/history" className="text-sm text-[#54265e] hover:underline">View history</Link>
            </div>
            {!data ? (
              <p role="status" className="rounded-2xl border border-[#eadff0] p-5 text-[#806b87]">{busy ? 'Loading your account…' : 'Refresh to load your account.'}</p>
            ) : transactions.length === 0 ? (
              <p className="rounded-2xl border border-[#eadff0] p-5 text-[#806b87]">No transactions recorded yet.</p>
            ) : (
              <div className="grid gap-3">
                {transactions.slice(0, 8).map(transaction => (
                  <article key={transaction.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#eadff0] bg-white/80 p-4">
                    <div className="min-w-0">
                      <p className="capitalize text-[#48204f]">{transaction.kind.replaceAll('_', ' ')} <span className="text-[#a793ac]">·</span> <span className="text-[#806b87]">{transaction.status.replaceAll('_', ' ')}</span></p>
                      <p className="mt-1 text-xs text-[#806b87]">{new Date(transaction.created_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}</p>
                      <p className="mt-1 break-all font-mono text-[11px] text-[#a08ca6]">{transaction.id}</p>
                    </div>
                    <strong className="text-teal-800">{money(transaction.amount)}</strong>
                  </article>
                ))}
              </div>
            )}
          </section>
          </>}

          {activeTab === 'tier' && <LiveInvestments view="portfolio" />}
          {activeTab === 'market' && <LiveInvestments view="market" />}
          {activeTab === 'friends' && <TeamDashboard embedded />}
          {activeTab === 'profile' && <section className="space-y-5 rounded-3xl border border-[#eadff0] bg-white/80 p-5 sm:p-7">
            <div>
              <h2 className="text-xl font-bold text-[#48204f]">Your account</h2>
              <p className="mt-1 text-sm text-[#806b87]">Account details and member tools.</p>
            </div>
            <dl className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl bg-[#f8f2fa] p-4"><dt className="text-sm text-[#806b87]">Phone number</dt><dd className="mt-1 font-semibold text-[#54265e]">{phone || '—'}</dd></div>
              <div className="rounded-2xl bg-[#f8f2fa] p-4"><dt className="text-sm text-[#806b87]">Member ID</dt><dd className="mt-1 break-all font-mono text-sm text-[#54265e]">{memberId || '—'}</dd></div>
            </dl>
            <div className="grid gap-3 sm:grid-cols-2">
              <Link href="/bank-account" className="flex items-center gap-3 rounded-2xl border border-[#eadff0] p-4 font-semibold text-[#54265e] hover:bg-[#f8f2fa]"><Banknote size={20} /> Bank accounts</Link>
              <Link href="/deposit/history" className="flex items-center gap-3 rounded-2xl border border-[#eadff0] p-4 font-semibold text-[#54265e] hover:bg-[#f8f2fa]"><History size={20} /> Transaction history</Link>
              <Link href="/deposit" className="flex items-center gap-3 rounded-2xl border border-[#eadff0] p-4 font-semibold text-[#54265e] hover:bg-[#f8f2fa]"><ArrowDownToLine size={20} /> Deposit</Link>
              <Link href="/withdrawal" className="flex items-center gap-3 rounded-2xl border border-[#eadff0] p-4 font-semibold text-[#54265e] hover:bg-[#f8f2fa]"><ArrowUpFromLine size={20} /> Withdraw</Link>
              <Link href="/money" className="flex items-center gap-3 rounded-2xl border border-[#eadff0] p-4 font-semibold text-[#54265e] hover:bg-[#f8f2fa]"><UserRound size={20} /> Wallet and recipients</Link>
            </div>
          </section>}

      <nav
        aria-label="Member bottom navigation"
        className="fixed inset-x-0 bottom-0 z-50 mx-auto grid max-w-[640px] grid-cols-5 gap-1 border-t border-[#eee5f0] bg-[#fffbff] px-3 pt-2 text-[#705a76] shadow-[0_-8px_24px_rgba(54,24,64,0.12)] md:bottom-4 md:left-1/2 md:-translate-x-1/2 md:rounded-2xl md:border"
        style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}
      >
        {([
          ['home', 'Home', Home],
          ['tier', 'My Tier', Sprout],
          ['market', 'Market', Store],
          ['friends', 'Friends', UsersRound],
          ['profile', 'Profile', UserRound],
        ] as const).map(([tab, label, Icon]) => (
          <button key={tab} type="button" onClick={() => setActiveTab(tab)} aria-current={activeTab === tab ? 'page' : undefined}
            className={`flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-2xl px-1 ${activeTab === tab ? 'bg-[#481f55] text-[#ffd67e]' : 'text-[#705a76] hover:bg-[#f4edf6]'}`}>
            <Icon size={21} aria-hidden="true" />
            <span className="text-xs font-semibold">{label}</span>
          </button>
        ))}
      </nav>
      </div>
    </main>
  );
}
