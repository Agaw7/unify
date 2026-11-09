'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Copy, House, RefreshCw, ShieldCheck, Sprout, Store, UserRound, UsersRound } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { moneyRequest } from '@/lib/money-client';

type ReferralMember = {
  id: string;
  created_at: string;
  phone_last4?: string;
  deposits: number;
  commission: number;
};

type ReferralLevel = {
  level: number;
  rate: number;
  count: number;
  commission: number;
  members: ReferralMember[];
};

type TeamData = {
  inviteCode: string | null;
  team: {
    total_commission: number;
    pending_commission?: number;
    weekly_commission?: number;
    monthly_commission?: number;
    active_friends?: number;
    levels: ReferralLevel[];
  };
};

const peso = (centavos: number) => new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
}).format(Number(centavos) / 100);

export default function TeamDashboard({ embedded = false }: { embedded?: boolean }) {
  const [data, setData] = useState<TeamData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data: session, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw new Error('Unable to verify your sign-in. Please try again.');
      if (!session.session) {
        window.location.replace('/login');
        return;
      }
      setData(await moneyRequest('/api/team'));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to load your referral information.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const inviteUrl = data?.inviteCode
    ? `${typeof window === 'undefined' ? '' : window.location.origin}/register?ref=${encodeURIComponent(data.inviteCode)}`
    : '';
  const levels = data?.team.levels ?? [];
  const memberCount = levels.reduce((total, level) => total + Number(level.count), 0);

  async function copyInvite() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Unable to copy the invite link. Select and copy it manually.');
    }
  }

  return (
    <main className={embedded ? 'text-[#48204f]' : 'min-h-screen bg-[#fcf8fd] text-[#48204f]'}>
      <div className={embedded ? 'mx-auto' : 'mx-auto flex min-h-screen max-w-[1500px]'}>
        {!embedded && <aside className="hidden w-56 shrink-0 border-r border-[#e7dce9] bg-[#fffbff] p-5 md:flex md:flex-col">
          <Link href="/dashboard" className="mb-8 flex items-center gap-3" aria-label="AUREVIA dashboard">
            <span className="grid size-11 place-items-center rounded-xl bg-gradient-to-br from-teal-300 to-violet-500 text-xl font-black text-[#281332]">A</span>
            <span className="font-bold tracking-[0.2em]">AUREVIA</span>
          </Link>
          <nav className="grid gap-2 text-sm" aria-label="Member navigation">
            <Link href="/dashboard" className="rounded-xl px-3 py-3 text-[#705a76] hover:bg-[#f4edf6]">Dashboard</Link>
            <Link href="/deposit" className="rounded-xl px-3 py-3 text-[#705a76] hover:bg-[#f4edf6]">Deposit</Link>
            <Link href="/withdraw" className="rounded-xl px-3 py-3 text-[#705a76] hover:bg-[#f4edf6]">Withdraw</Link>
            <Link href="/market" className="rounded-xl px-3 py-3 text-[#705a76] hover:bg-[#f4edf6]">Market</Link>
            <Link href="/team" aria-current="page" className="rounded-xl border border-teal-300 bg-teal-100 px-3 py-3 text-teal-800">Friends</Link>
            <Link href="/bank-account" className="rounded-xl px-3 py-3 text-[#705a76] hover:bg-[#f4edf6]">Bank accounts</Link>
            <Link href="/deposit/history" className="rounded-xl px-3 py-3 text-[#705a76] hover:bg-[#f4edf6]">Transactions</Link>
          </nav>
          <div className="mt-auto rounded-xl border border-[#e7dce9] bg-[#f7f0fa] p-3 text-xs text-[#705a76]">
            <ShieldCheck size={18} className="mb-2 text-teal-700" aria-hidden="true" />
            Private referral information for your signed-in account.
          </div>
        </aside>}

        <div className={embedded ? 'min-w-0 space-y-5' : 'min-w-0 flex-1 px-4 py-5 pb-28 sm:px-7 lg:px-10 md:pb-8'}>
          <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-bold tracking-[0.24em] text-teal-500">AUREVIA MEMBER AREA</p>
              <h1 className="mt-2 text-2xl font-bold text-[#48204f] sm:text-3xl">Friends &amp; Referrals</h1>
              <p className="mt-1 text-sm text-[#806b87]">Your referral code, network, and recorded commissions.</p>
            </div>
            <div className="flex items-center gap-3">
              {!embedded && <Link href="/dashboard" className="inline-flex items-center gap-2 rounded-xl border border-[#eadff0] bg-white/70 px-3 py-2 text-sm text-[#54265e]">
                <ArrowLeft size={17} aria-hidden="true" /> Dashboard
              </Link>}
              <button onClick={() => void load()} disabled={loading} aria-label="Refresh referral information" className="rounded-xl border border-[#eadff0] bg-white/70 p-3 text-teal-700 disabled:opacity-50">
                <RefreshCw size={18} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
              </button>
            </div>
          </header>

          {error && <p role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">{error}</p>}

          <section className="rounded-[30px] border border-teal-700/60 bg-gradient-to-br from-[#301844] via-[#42214f] to-[#261432] p-5 text-white shadow-[0_18px_42px_rgba(54,24,64,0.18)] sm:p-8">
            <div className="flex items-center gap-3">
              <span className="grid size-12 place-items-center rounded-2xl bg-white/10 text-violet-100"><UsersRound size={25} aria-hidden="true" /></span>
              <div>
                <p className="text-sm text-violet-100">Recorded total commissions</p>
                <p className="mt-1 text-3xl font-bold">{data ? peso(data.team.total_commission) : '—'}</p>
              </div>
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
                <p className="text-sm text-violet-100">People in your network</p>
                <p className="mt-1 text-2xl font-bold">{data ? memberCount : '—'}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
                <p className="text-sm text-violet-100">Active direct friends</p>
                <p className="mt-1 text-2xl font-bold">{data?.team.active_friends ?? '—'}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
                <p className="text-sm text-violet-100">Pending commissions</p>
                <p className="mt-1 text-2xl font-bold">{data ? peso(data.team.pending_commission ?? 0) : '—'}</p>
              </div>
            </div>
          </section>

          <section className="mt-5 rounded-3xl border border-[#eadff0] bg-white/80 p-5 shadow-sm sm:p-6">
            <h2 className="text-lg font-bold text-[#48204f]">Your invite link</h2>
            <p className="mt-1 text-sm text-[#806b87]">Share this link to invite friends. Your code is loaded from your own profile.</p>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <input aria-label="Your invite link" readOnly value={inviteUrl} placeholder={loading ? 'Loading your invite link…' : 'Invite link unavailable'} className="min-w-0 flex-1 rounded-xl border border-[#eadff0] bg-[#fcf8fd] px-4 py-3 text-sm text-[#54265e]" />
              <button type="button" onClick={() => void copyInvite()} disabled={!inviteUrl} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#54265e] px-5 py-3 font-semibold text-white disabled:opacity-50">
                <Copy size={17} aria-hidden="true" /> {copied ? 'Copied!' : 'Copy link'}
              </button>
            </div>
            {data && !data.inviteCode && <p className="mt-2 text-sm text-amber-800">An invite code is not available on this profile.</p>}
          </section>

          <section className="mt-7 space-y-4">
            <div>
              <h2 className="text-xl font-bold text-[#48204f]">Referral network</h2>
              <p className="mt-1 text-sm text-[#806b87]">Member identifiers are partially masked for privacy. Deposit totals include completed records only.</p>
            </div>
            {loading && !data ? (
              <p role="status" className="rounded-2xl border border-[#eadff0] bg-white/80 p-5 text-[#806b87]">Loading your referral information…</p>
            ) : !data ? (
              <p className="rounded-2xl border border-[#eadff0] bg-white/80 p-5 text-[#806b87]">Referral information is unavailable. Refresh to try again.</p>
            ) : levels.map(level => (
              <article key={level.level} className="rounded-2xl border border-[#eadff0] bg-white/80 p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-bold text-[#54265e]">Tier {level.level} <span className="font-normal text-[#806b87]">· {level.rate}%</span></h3>
                    <p className="mt-1 text-sm text-[#806b87]">{level.count} {level.count === 1 ? 'member' : 'members'}</p>
                  </div>
                  <p className="text-sm text-[#775d80]">Recorded commission <strong className="text-[#54265e]">{peso(level.commission)}</strong></p>
                </div>
                {level.members.length === 0 ? (
                  <p className="rounded-xl bg-[#f8f2fa] p-4 text-sm text-[#806b87]">No members in this tier yet.</p>
                ) : (
                  <div className="grid gap-2">
                    {level.members.map(member => (
                      <div key={member.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#f8f2fa] p-4">
                        <div>
                          <p className="font-semibold text-[#54265e]">{member.phone_last4 ? `Member ending ${member.phone_last4}` : 'Member'}</p>
                          <p className="mt-1 text-xs text-[#806b87]">Joined {new Date(member.created_at).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric' })}</p>
                          <p className="mt-1 text-xs text-[#806b87]">Completed deposits: {peso(member.deposits)}</p>
                        </div>
                        <p className="text-sm text-[#775d80]">Commission <strong className="text-[#54265e]">{peso(member.commission)}</strong></p>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </section>
        </div>
      </div>

      {!embedded && <nav aria-label="Member bottom navigation" className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-5 gap-1 border-t border-[#eee5f0] bg-[#fffbff] px-3 pt-2 text-[#705a76] shadow-[0_-8px_24px_rgba(54,24,64,0.12)] md:hidden" style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}>
        <Link href="/dashboard" className="flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-2xl px-1 hover:bg-[#f4edf6]"><House size={20} aria-hidden="true" /><span className="text-xs font-semibold">Home</span></Link>
        <Link href="/investments" className="flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-2xl px-1 hover:bg-[#f4edf6]"><Sprout size={20} aria-hidden="true" /><span className="text-xs font-semibold">My Tier</span></Link>
        <Link href="/market" className="flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-2xl px-1 hover:bg-[#f4edf6]"><Store size={20} aria-hidden="true" /><span className="text-xs font-semibold">Market</span></Link>
        <Link href="/team" aria-current="page" className="flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-2xl bg-[#481f55] px-1 text-[#ffd67e]"><UsersRound size={20} aria-hidden="true" /><span className="text-xs font-semibold">Friends</span></Link>
        <Link href="/money" className="flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-2xl px-1 hover:bg-[#f4edf6]"><UserRound size={20} aria-hidden="true" /><span className="text-xs font-semibold">Profile</span></Link>
      </nav>}
    </main>
  );
}
