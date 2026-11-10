'use client';

import { formatPhp } from '@/lib/format-php';
import Link from 'next/link';
import Image from 'next/image';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Users, Wallet, Coins, Gift, Ticket, Search, RefreshCw, ShieldCheck, Network, LayoutDashboard, ArrowDownToLine, ArrowUpFromLine, ReceiptText, ChevronLeft, ChevronRight, Eye, CalendarDays, UserRound, ArrowUpRight, Menu, CalendarCheck, LogIn, Clock3, Copy, type LucideIcon } from 'lucide-react';
import { moneyRequest } from '@/lib/money-client';
import { memberMatchesSearch } from '@/lib/member-search';
import { productDetails, productDisplayName } from '@/lib/product-presentation';
import WithdrawalManagement from './WithdrawalManagement';
import DepositManagement from './DepositManagement';
import styles from './admin-neon.module.css';

type Member = { id: string; phone: string | null; role: string; joined: string; freePlan: boolean; invites: string[]; recordedBalance: number | null; recordedCommission: number | null; recordedRewards: number | null; recordedInviteDeposits: number | null };
type MemberOption = { id: string; phone: string | null; role: string };
type MarketProduct = { id: string; name: string; price: number; daily_income: number; duration_days: number };
type Row = { id: string; user_id?: string; kind?: string; amount?: number; status?: string; created_at?: string; level?: number; name?: string; acquisition?: string; source?: string; reference?: string };
type Data = { members: Member[]; summary: Record<string, number | null>; recent: Row[]; fetchedAt: string; detailMember: string | null; detail: { historical: Row[] | null; commissions: Row[] | null; plans: Row[] | null; inviteDeposits: Row[] | null } | null; recordsHidden?: boolean };
type DashboardStats = { businessBudget: { available: number }; totalDeposits: number; totalWithdrawalsPaid: number; depositsToday: number; withdrawalsPaidToday: number; signinsToday: number; totalMembers: number; pendingWithdrawals: number };
const peso = (value: number | null | undefined) => value == null ? '—' : formatPhp(value / 100);
const php = (value: number | null | undefined) => value == null ? '—' : formatPhp(value);
const tabs = ['Overview', 'Invites', 'Deposits', 'Commission', 'Daily Reward'] as const;
const date = (value?: string) => value ? new Date(value).toLocaleDateString('en-PH', { month:'short', day:'numeric', year:'numeric' }) : '—';
function Panel({ title, subtitle, Icon, action, children, className = '', id }: { title: string; subtitle?: string; Icon: LucideIcon; action?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return <section className={`${styles.panel} ${className}`} id={id}><div className={styles.panelHead}><div className={styles.panelTitle}><span className={styles.roundIcon}><Icon size={22} aria-hidden="true" /></span><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div></div>{action}</div>{children}</section>;
}
function Metric({ label, value, Icon, hint }: { label: string; value: string | number; Icon: LucideIcon; hint?: string }) {
  return <div className={styles.metric}><span className={styles.metricIcon}><Icon size={27} aria-hidden="true" /></span><div><span>{label}</span><strong>{value}</strong>{hint && <small>{hint}</small>}</div></div>;
}
function DashboardStat({ label, value, description, Icon }: { label: string; value: string | number; description: string; Icon: LucideIcon }) {
  return <article className={styles.dashboardStat}><span className={styles.dashboardStatIcon}><Icon size={18} aria-hidden="true" /></span><strong className={styles.dashboardStatLabel}>{label}</strong><b>{value}</b><small>{description}</small></article>;
}
function Status({ value }: { value?: string }) {
  const tone = ['completed','paid','approved'].includes(value ?? '') ? styles.green : ['rejected','failed','reversed'].includes(value ?? '') ? styles.red : styles.amber;
  return <span className={`${styles.status} ${tone}`}>{(value ?? 'Unavailable').replaceAll('_',' ')}</span>;
}
function TransactionTable({ rows, loading, phone, empty }: { rows: Row[]; loading: boolean; phone: (id?: string) => string; empty: string }) {
  return <div className={styles.tableScroll}><table><thead><tr><th>Date</th><th>Member (phone)</th><th>Type / source</th><th>Amount</th><th>Status</th></tr></thead><tbody>{rows.map(r => <tr key={`${r.source}-${r.id}`}><td>{date(r.created_at)}</td><td>{phone(r.user_id)}</td><td><span className={styles.type}>{r.kind?.replaceAll('_',' ')}</span><small>{r.source}</small></td><td>{peso(Number(r.amount))}</td><td><Status value={r.status} /></td></tr>)}{!rows.length && <tr><td colSpan={5} className={styles.empty}>{loading ? 'Loading transactions…' : empty}</td></tr>}</tbody></table></div>;
}

function WithdrawableBalanceGrant({ members, loading, onGranted }: { members: MemberOption[]; loading: boolean; onGranted: () => void }) {
  type GrantedMember = { id: string; phone: string | null; grantTotal: number; activeInvites: number; inviteDepositTotal: number };
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [memberToAdd, setMemberToAdd] = useState('');
  const [amount, setAmount] = useState(1000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [grantedMembers, setGrantedMembers] = useState<GrantedMember[]>([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');
  const key = useRef<string | null>(null);
  const grantTotal = selectedIds.length * (Number.isFinite(amount) ? amount : 0);

  const loadGrantedMembers = useCallback(async () => {
    setReportLoading(true);
    setReportError('');
    try {
      const result = await moneyRequest('/api/admin/free-balance');
      setGrantedMembers(result.grantedMembers as GrantedMember[]);
    } catch (failure) {
      setReportError(failure instanceof Error ? failure.message : 'Unable to load granted member invite records.');
    } finally {
      setReportLoading(false);
    }
  }, []);

  useEffect(() => { void loadGrantedMembers(); }, [loadGrantedMembers]);

  function selectMember(id: string) {
    setMemberToAdd('');
    if (!id || selectedIds.includes(id)) return;
    key.current = null;
    setError('');
    setMessage('');
    setSelectedIds(previous => [...previous, id]);
  }

  function removeMember(id: string) {
    key.current = null;
    setMessage('');
    setSelectedIds(previous => previous.filter(selectedId => selectedId !== id));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!selectedIds.length) {
      setError('Select at least one member.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      key.current ??= crypto.randomUUID();
      const result = await moneyRequest('/api/admin/free-balance', {
        userIds: selectedIds,
        amount,
        reason: 'Admin promotional free balance grant',
        key: key.current,
      });
      setMessage(result.alreadyGranted
        ? 'This grant was already processed.'
        : `Granted ${peso(amount * 100)} to ${selectedIds.length} member${selectedIds.length === 1 ? '' : 's'} (${peso(grantTotal * 100)} total).`);
      key.current = null;
      setSelectedIds([]);
      await loadGrantedMembers();
      onGranted();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to grant withdrawable balance.');
    } finally {
      setBusy(false);
    }
  }

  return <div className={styles.inset}>
    <h3>Grant withdrawable balance</h3>
    <p className={styles.caption}>Select members and the amount each one receives. The grant is credited to available wallet balance, not sent as a transfer.</p>
    <label className={styles.fieldLabel} htmlFor="free-balance-member">Member phone number</label>
    <select id="free-balance-member" className={styles.memberGrantSelect} value={memberToAdd} disabled={loading || busy || selectedIds.length >= 50} onChange={event => selectMember(event.target.value)}>
        <option value="">{loading ? 'Loading members…' : 'Select a member'}</option>
        {members.map(member => <option key={member.id} value={member.id} disabled={selectedIds.includes(member.id)}>{member.phone ?? member.id.slice(0, 8)}{selectedIds.includes(member.id) ? ' · Selected' : ''}</option>)}
    </select>
    {selectedIds.length > 0 && <div className={styles.memberGrantList} aria-label="Selected members">
      {selectedIds.map(id => {
        const member = members.find(item => item.id === id);
        return <div className={styles.memberGrantOption} key={id}>
          <span>{member?.phone ?? 'Phone unavailable'}<small>Member ID: {id.slice(0, 8)}</small></span>
          <button type="button" className={styles.miniButton} disabled={busy} onClick={() => removeMember(id)}>Remove</button>
        </div>;
      })}
    </div>}
    <form className={styles.balanceGrantForm} onSubmit={submit}>
      <label className={styles.fieldLabel} htmlFor="free-balance-amount">Amount per member</label>
      <select id="free-balance-amount" className={styles.memberGrantSelect} value={amount} required disabled={busy} onChange={event => { setAmount(Number(event.target.value)); key.current = null; setMessage(''); }}>
        <option value={1000}>₱1,000</option>
        <option value={1500}>₱1,500</option>
      </select>
      <p className={styles.caption}>{selectedIds.length} selected · Total grant: {peso(grantTotal * 100)}</p>
      <button type="submit" className={styles.primaryButton} disabled={loading || busy || selectedIds.length === 0 || ![1000, 1500].includes(amount)}><Coins size={16} />{busy ? 'Granting…' : 'Grant balance'}</button>
    </form>
    {message && <p className={styles.success} role="status">{message}</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    <p className={styles.caption}>Paid from verified available business reward funds. Members can request withdrawal through the normal process, subject to identity verification, account restrictions, and withdrawal review. This does not mark a transfer as paid.</p>
    <section className={styles.memberGrantReport} aria-labelledby="free-balance-invites-title">
      <div className={styles.panelHead}>
        <h3 id="free-balance-invites-title">Invites from Free Balance recipients</h3>
        <button type="button" className={styles.miniButton} disabled={reportLoading} onClick={() => void loadGrantedMembers()}>
          <RefreshCw size={13} className={reportLoading ? styles.spinning : ''} /> Refresh
        </button>
      </div>
      <p className={styles.caption}>Shows active invited members and their completed deposits, only for members who received a Free Balance grant.</p>
      {reportError && <p className={styles.error} role="alert">{reportError}</p>}
      <div className={styles.tableScroll}>
        <table>
          <thead><tr><th>Recipient phone</th><th>Granted balance</th><th>Active invites</th><th>Invite deposits</th></tr></thead>
          <tbody>
            {grantedMembers.map(member => <tr key={member.id}>
              <td>{member.phone ?? 'Phone unavailable'}</td>
              <td>{peso(member.grantTotal)}</td>
              <td>{member.activeInvites}</td>
              <td>{peso(member.inviteDepositTotal)}</td>
            </tr>)}
            {!grantedMembers.length && <tr><td colSpan={4} className={styles.empty}>{reportLoading ? 'Loading granted members…' : reportError ? 'Grant report unavailable.' : 'No Free Balance grants recorded yet.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  </div>;
}

function GiftCodeCreator() {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setCode('');
    setError('');
    setCopied(false);
    try {
      const result = await moneyRequest('/api/rewards', { action: 'create' });
      setCode(result.code);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to create gift code.');
    } finally {
      setBusy(false);
    }
  }
  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setError('Unable to copy the code. Please select and copy it manually.');
    }
  }
  return <div className={styles.inset}>
    <h3>Create gift code</h3>
    <form onSubmit={create}>
      <button type="submit" className={styles.primaryButton} disabled={busy}><Gift size={16} />{busy ? 'Creating…' : 'Create code'}</button>
    </form>
    <p className={styles.caption}>Each code is available to 50 members, with one redemption per member. Most rewards are ₱1–₱5, with a 5% chance of ₱6–₱10.</p>
    {code && <p role="status" style={{ overflowWrap: 'anywhere', marginTop: 10 }}>New code: <code>{code}</code> <button type="button" className={styles.miniButton} onClick={() => void copyCode()}><Copy size={13} />{copied ? 'Copied' : 'Copy'}</button></p>}
    {error && <p role="alert" style={{ color: '#ff9b9b', marginTop: 8 }}>{error}</p>}
  </div>;
}

export default function AdminOverview() {
  const [data, setData] = useState<Data | null>(null);
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState('');
  const [freePlanProducts, setFreePlanProducts] = useState<MarketProduct[]>([]);
  const [freePlanProduct, setFreePlanProduct] = useState('');
  const [freePlanProductsLoading, setFreePlanProductsLoading] = useState(false);
  const [freePlanProductsError, setFreePlanProductsError] = useState('');
  const [freeBalanceMembers, setFreeBalanceMembers] = useState<MemberOption[]>([]);
  const [freeBalanceMembersError, setFreeBalanceMembersError] = useState('');
  const [freeBalanceMembersLoading, setFreeBalanceMembersLoading] = useState(false);
  const [tab, setTab] = useState<typeof tabs[number]>('Overview');
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');
  const [statsError, setStatsError] = useState('');
  const [statsLoading, setStatsLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [activeNav, setActiveNav] = useState('Dashboard');
  const generation = useRef(0);
  const hideRecords = activeNav !== 'FreePlan';
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true); setError('');
    try {
      const result: Data = await moneyRequest(`/api/admin/member-overview${hideRecords ? '?hideRecords=true' : ''}`);
      if (current === generation.current) setData(result);
    } catch (e) { if (current === generation.current) setError(e instanceof Error ? e.message : 'Unable to load records'); }
    finally { if (current === generation.current) setLoading(false); }
  }, [hideRecords]);
  const loadDashboardStats = useCallback(async () => {
    setStatsLoading(true);
    setStatsError('');
    try {
      setDashboardStats(await moneyRequest('/api/admin/live-dashboard'));
    } catch (e) {
      setStatsError(e instanceof Error ? e.message : 'Unable to load dashboard statistics');
    } finally {
      setStatsLoading(false);
    }
  }, []);
  const refreshDashboard = useCallback(() => {
    void Promise.all([load(), loadDashboardStats()]);
  }, [load, loadDashboardStats]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadDashboardStats(); }, [loadDashboardStats]);
  useEffect(() => {
    if (activeNav !== 'Free Balance') return;
    let current = true;
    setFreeBalanceMembersLoading(true);
    setFreeBalanceMembersError('');
    void moneyRequest('/api/admin/users').then(result => {
      if (current) setFreeBalanceMembers((result.members as MemberOption[]).filter(m => m.role === 'user'));
    }).catch(failure => {
      if (current) setFreeBalanceMembersError(failure instanceof Error ? failure.message : 'Unable to load members.');
    }).finally(() => {
      if (current) setFreeBalanceMembersLoading(false);
    });
    return () => { current = false; };
  }, [activeNav]);
  useEffect(() => {
    if (activeNav !== 'FreePlan') return;
    let current = true;
    setFreePlanProductsLoading(true);
    setFreePlanProductsError('');
    void moneyRequest('/api/admin/free-plans').then(result => {
      if (current) setFreePlanProducts(result.products as MarketProduct[]);
    }).catch(failure => {
      if (current) setFreePlanProductsError(failure instanceof Error ? failure.message : 'Unable to load Market choices.');
    }).finally(() => {
      if (current) setFreePlanProductsLoading(false);
    });
    return () => { current = false; };
  }, [activeNav]);
  const member = data?.members.find(m => m.id === selected);
  const detail = data?.detailMember === selected ? data.detail : null;
  const matching = data?.members.filter(m => memberMatchesSearch(m, search)) ?? [];
  const pageCount = Math.max(1, Math.ceil(matching.length / 5));
  const shownPage = Math.min(page, pageCount - 1);
  const visible = matching.slice(shownPage * 5, shownPage * 5 + 5);
  const phone = (id?: string) => data?.members.find(m => m.id === id)?.phone ?? (id ? id.slice(0,8) : '—');
  const selectMember = (id: string) => { setSelected(id); setTab('Overview'); };
  const freePlans = data?.members.filter(m => m.freePlan) ?? [];
  const selectedFreePlanProduct = freePlanProducts.find(product => product.id === freePlanProduct);
  function history(rows: Row[] | null | undefined) {
    if (loading || !detail) return <p className={styles.empty} role="status">Loading member records…</p>;
    if (!rows) return <p className={styles.empty}>Records unavailable.</p>;
    return rows.length ? <div className={styles.records}>{[...rows].sort((a,b) => String(b.created_at).localeCompare(String(a.created_at))).map(r => <div key={r.id}><span>{r.name ?? r.kind?.replaceAll('_',' ') ?? `Tier ${r.level ?? ''}`}<small>{date(r.created_at)} · {r.id.slice(0, 8)}</small></span><span><strong>{r.amount == null ? r.acquisition?.replaceAll('_',' ') : peso(Number(r.amount))}</strong>{r.status && <Status value={r.status} />}</span></div>)}</div> : <p className={styles.empty}>No records yet.</p>;
  }
  const nav: [string,string,LucideIcon][] = [
    ['Dashboard','dashboard',LayoutDashboard],['Members','members',Users],['Deposits','deposits',ArrowDownToLine],['Withdrawals','withdrawals',ArrowUpFromLine],['FreePlan','free-plan',Gift],['Free Balance','free-balance',Coins],['Reward Budget','reward-budget',Wallet],['Gift Codes','gift-codes',Ticket],['Wallets','wallets',Wallet],['Transactions','transactions',ReceiptText],
  ];
  return <div className={styles.shell}>
    <aside className={styles.sidebar}><Link href="/admin" className={styles.brand}><span className={styles.brandMark}><Image src="/aurevia-icon.png" alt="" fill sizes="66px" /></span><strong>AUREVIA</strong><small>Admin Panel</small></Link><button className={styles.mobileMenu} aria-expanded={mobileMenu} aria-controls="admin-navigation" onClick={() => setMobileMenu(!mobileMenu)}><Menu size={16} /> Menu</button><nav id="admin-navigation" className={mobileMenu ? styles.navOpen : ''} aria-label="Admin navigation">{nav.map(([label,section,Icon]) => section === 'reward-budget' ? <Link href="/admin/reward-budget" className={styles.navItem} key={section} onClick={() => setMobileMenu(false)}><Icon size={18} aria-hidden="true" />{label}</Link> : <button type="button" className={`${styles.navItem} ${activeNav === label ? styles.navActive : ''}`} key={section} aria-current={activeNav === label ? 'page' : undefined} onClick={() => {setActiveNav(label);setMobileMenu(false);}}><Icon size={18} aria-hidden="true" />{label}</button>)}</nav><div className={styles.sideFoot}><ShieldCheck size={16} /><span>Protected workspace<small>{data ? 'Admin session verified' : 'Admin sign-in required'}</small></span></div><Link className={styles.homeLink} href="/dashboard">← Member Home</Link></aside>
    <main className={styles.main} id="dashboard">
      <header className={styles.header}><div><span className={styles.eyebrow}>AUREVIA / ADMINISTRATION</span><h1>Admin Dashboard</h1><p>Financial overview, member activity and pending requests</p></div><div className={styles.headerTools}><span className={styles.date}><CalendarDays size={15} />{date(data?.fetchedAt)}</span>      <Link className={styles.mode} href="/admin/payment-settings"><Eye size={15} /> Payment settings</Link><button aria-label="Refresh dashboard" className={styles.refresh} onClick={refreshDashboard} disabled={loading || statsLoading}><RefreshCw size={18} className={loading || statsLoading ? styles.spinning : ''} /></button><Link className={styles.adminProfile} href="/admin/payment-settings"><span><UserRound size={21} /></span><div>Admin<small>Administrator</small></div></Link></div></header>
      {error && <p className={styles.error} role="alert">{error} {data && 'Last loaded figures retained.'}</p>}
      {statsError && <p className={styles.error} role="alert">{statsError} {dashboardStats && 'Last loaded statistics retained.'}</p>}
      {activeNav === 'Dashboard' && <section className={styles.summary} aria-label="Financial overview, member activity and pending requests">
        <DashboardStat label="AUREVIA Balance" value={php(dashboardStats?.businessBudget.available)} description="Business available funds" Icon={Wallet} />
        <DashboardStat label="Deposit Balance" value={php(dashboardStats?.totalDeposits)} description="Total completed deposits" Icon={ArrowDownToLine} />
        <DashboardStat label="Withdrawal Paid Balance" value={php(dashboardStats?.totalWithdrawalsPaid)} description="Total paid withdrawals" Icon={ArrowUpFromLine} />
        <DashboardStat label="Today's Deposits" value={php(dashboardStats?.depositsToday)} description="Completed today" Icon={CalendarCheck} />
        <DashboardStat label="Today's Withdrawal Paid" value={php(dashboardStats?.withdrawalsPaidToday)} description="Paid today" Icon={CalendarCheck} />
        <DashboardStat label="Today's Sign-ins" value={dashboardStats?.signinsToday.toLocaleString('en-PH') ?? '—'} description="Unique member logins" Icon={LogIn} />
        <DashboardStat label="Overall Members" value={dashboardStats?.totalMembers.toLocaleString('en-PH') ?? '—'} description="Registered members" Icon={Users} />
        <DashboardStat label="Pending Withdrawals" value={php(dashboardStats?.pendingWithdrawals)} description="Awaiting approval" Icon={Clock3} />
      </section>}
      <div className={styles.grid}>
        {activeNav === 'Dashboard' && <Panel title="Payment Methods (Manual)" subtitle="Configuration overview · live execution paused" Icon={Wallet} className={styles.half}>
          <div className={styles.paymentRow}><span className={styles.paymentLogo}>P</span><div><strong>PalawanPay — Deposits</strong><small>Manual verification required</small></div><span className={`${styles.status} ${styles.amber}`}>Paused</span><Link className={styles.outlineButton} href="/admin/payment-settings">Review setup <ArrowUpRight size={13} /></Link></div>
          <div className={styles.paymentRow}><span className={styles.paymentLogo}><Wallet size={22} /></span><div><strong>GCash / Maya — Recipients</strong><small>Manual withdrawal records</small></div><span className={`${styles.status} ${styles.amber}`}>Paused</span><Link className={styles.outlineButton} href="/admin/money">View records</Link></div>
        </Panel>}
        {activeNav === 'FreePlan' && <Panel title="FreePlan Management" subtitle="Review recorded grants and their members’ networks" Icon={Gift} className={`${styles.half} ${styles.goldPanel}`} action={<Link className={styles.textLink} href="/admin/free-plans">Manage plans</Link>}><div className={styles.management}><div className={styles.inset}><h3>Grant a Market plan</h3><label htmlFor="free-plan-member">Member phone number</label><select id="free-plan-member" value={selected} onChange={e => selectMember(e.target.value)}><option value="">Select a member</option>{data?.members.filter(m => m.role === 'user').map(m => <option key={m.id} value={m.id}>{m.phone ?? m.id.slice(0,8)}</option>)}</select><label htmlFor="free-plan-market-product">Market choice</label><select id="free-plan-market-product" className={styles.memberGrantSelect} value={freePlanProduct} disabled={freePlanProductsLoading || !!freePlanProductsError} onChange={e => setFreePlanProduct(e.target.value)}><option value="">{freePlanProductsLoading ? 'Loading Market choices…' : 'Select a Market plan'}</option>{freePlanProducts.map(product => <option key={product.id} value={product.id}>{productDisplayName(product.name)} · {php(Number(product.price))} · {php(Number(product.daily_income))}/day · {product.duration_days} days</option>)}</select>{freePlanProductsError && <p className={styles.error} role="alert">{freePlanProductsError}</p>}{selectedFreePlanProduct && <p className={styles.caption}>{productDisplayName(selectedFreePlanProduct.name)}{productDetails(selectedFreePlanProduct.name)?.tier ? ` · Tier ${productDetails(selectedFreePlanProduct.name)?.tier}` : ''}. These choices match the products shown in Market.</p>}<p className={styles.caption}>Select the member and Market plan here, then continue to review and grant it.</p>{selected && freePlanProduct ? <Link className={styles.primaryButton} href={`/admin/free-plans?${new URLSearchParams({ member: selected, product: freePlanProduct })}`}><Gift size={16} /> Grant selected Market plan</Link> : <button type="button" className={styles.primaryButton} disabled><Gift size={16} /> Select member and Market plan</button>}</div><div className={styles.tableScroll}><table><thead><tr><th>Member phone</th><th>Invites</th><th>Plan</th></tr></thead><tbody>{freePlans.slice(0,4).map(m => <tr key={m.id}><td><button className={styles.phoneButton} onClick={() => selectMember(m.id)}>{m.phone ?? m.id.slice(0,8)}</button></td><td>{m.invites.length}</td><td><span className={`${styles.status} ${styles.green}`}>Recorded</span></td></tr>)}{!freePlans.length && <tr><td colSpan={3} className={styles.empty}>{loading ? 'Loading FreePlan records…' : 'No FreePlan records.'}</td></tr>}</tbody></table></div></div>{!freePlanProductsLoading && !freePlanProductsError && freePlanProducts.length === 0 && <p className={styles.empty} role="status">No Market choices are available right now.</p>}</Panel>}
        {activeNav === 'Free Balance' && <Panel title="Free Balance" subtitle="Admin-granted withdrawable balance" Icon={Coins} className={`${styles.half} ${styles.goldPanel}`}><div><WithdrawableBalanceGrant members={freeBalanceMembers} loading={freeBalanceMembersLoading} onGranted={refreshDashboard} />{freeBalanceMembersError && <p className={styles.error} role="alert">{freeBalanceMembersError}</p>}</div></Panel>}
        {activeNav === 'Gift Codes' && <Panel title="Gift Codes" subtitle="Create promotional codes separately from Free Balance" Icon={Ticket} className={`${styles.half} ${styles.goldPanel}`}><GiftCodeCreator /></Panel>}
        {activeNav === 'Members' && <Panel title="All Members (Network Overview)" subtitle="Phone-based records, invitations and historical earnings" Icon={Users} className={`${styles.memberPanel} ${styles.goldPanel}`} action={<span className={styles.count}>{data?.summary.members ?? '—'} members</span>}><label className={styles.search}><Search size={15} /><input value={search} onChange={e => {setSearch(e.target.value);setPage(0);}} placeholder="Search phone number or member ID" aria-label="Search phone number or member ID" /></label><div className={styles.tableScroll}><table><thead><tr><th>Phone number</th><th>Plan</th><th>Invites</th><th>Invite deposits</th><th>Commission</th><th>Action</th></tr></thead><tbody>{data?.recordsHidden ? <tr><td colSpan={6} className={styles.empty}>Member records are hidden on this dashboard. Stored records are unchanged.</td></tr> : visible.map(m => <tr key={m.id} className={selected === m.id ? styles.selectedRow : ''}><td>{m.phone ?? 'Phone unavailable'}<small>{m.id.slice(0,8)}</small></td><td>{m.freePlan ? <span className={`${styles.status} ${styles.green}`}>FreePlan</span> : '—'}</td><td>{m.invites.length}</td><td>{peso(m.recordedInviteDeposits)}</td><td>{peso(m.recordedCommission)}</td><td><a href="#member-detail" className={styles.miniButton} onClick={() => selectMember(m.id)}><Eye size={12} /> View</a></td></tr>)}{!data?.recordsHidden && visible.length === 0 && <tr><td colSpan={6} className={styles.empty}>{loading ? 'Loading members…' : data ? 'No matching members.' : 'Sign in to load members.'}</td></tr>}</tbody></table></div><div className={styles.pagination}><span>{data?.recordsHidden ? 'Records hidden' : matching.length ? `${shownPage * 5 + 1}–${Math.min((shownPage + 1) * 5, matching.length)} of ${matching.length}` : '0 members'}</span><div><button aria-label="Previous member page" disabled={shownPage === 0 || data?.recordsHidden} onClick={() => setPage(shownPage-1)}><ChevronLeft size={15} /></button><span>Page {shownPage+1} / {data?.recordsHidden ? 1 : pageCount}</span><button aria-label="Next member page" disabled={shownPage+1 >= pageCount || data?.recordsHidden} onClick={() => setPage(shownPage+1)}><ChevronRight size={15} /></button></div></div></Panel>}
        {activeNav === 'Members' && <Panel title="Member Detail — Rewards & Network" Icon={UserRound} className={styles.detailPanel}>
          {data?.recordsHidden ? <p className={styles.empty}>Member detail records are hidden on this dashboard. Stored records are unchanged.</p> : member ? <><div className={styles.memberIdentity}><span className={styles.userIcon}><UserRound size={27} /></span><div><strong>{member.phone ?? 'Phone unavailable'}</strong><small>Member ID: {member.id.slice(0,8)}</small></div><span className={`${styles.status} ${member.freePlan ? styles.green : styles.amber}`}>{member.freePlan ? 'FreePlan recorded' : member.role}</span></div><div className={styles.tabs} role="tablist" aria-label="Member records">{tabs.map(t => <button role="tab" aria-selected={tab === t} aria-controls="member-panel" id={'tab-'+t.replaceAll(' ','-')} key={t} onClick={() => setTab(t)}>{t}{t === 'Invites' ? ` (${member.invites.length})` : ''}</button>)}</div><div id="member-panel" role="tabpanel" aria-labelledby={'tab-'+tab.replaceAll(' ','-')}>
            {tab === 'Overview' && <><div className={styles.detailMetrics}><Metric label="Recorded wallet" value={peso(member.recordedBalance)} Icon={Wallet}/><Metric label="Direct invites" value={member.invites.length} Icon={Users}/><Metric label="Invite deposits" value={peso(member.recordedInviteDeposits)} Icon={Coins}/><Metric label="Paid commission" value={peso(member.recordedCommission)} Icon={Network}/><Metric label="Tier rewards" value={peso(member.recordedRewards)} Icon={CalendarDays}/></div><p className={styles.caption}>Historical amounts are read only.</p></>}
            {tab === 'Invites' && <div className={styles.records}>{member.invites.length ? member.invites.map(id => <div key={id}><span>{phone(id)}<small>Direct invite</small></span><button className={styles.miniButton} onClick={() => selectMember(id)}>View</button></div>) : <p className={styles.empty}>No direct invites yet.</p>}</div>}
            {tab === 'Deposits' && history(detail?.historical?.filter(r=>r.kind === 'deposit'))}
            {tab === 'Commission' && history(detail?.commissions)}
            {tab === 'Daily Reward' && <>{history(detail?.historical?.filter(r=>r.kind === 'investment_return'))}<h3>Recorded tiers</h3>{history(detail?.plans)}</>}
          </div></> : <p className={styles.empty}>Choose a member to view their network and records.</p>}
        </Panel>}
        {activeNav === 'Deposits' && <div className={styles.full}><DepositManagement onReviewed={refreshDashboard} /></div>}
        {activeNav === 'Withdrawals' && <div className={styles.full}><WithdrawalManagement onCompleted={refreshDashboard} /></div>}
        {activeNav === 'Wallets' && <Panel title="Wallets" subtitle="Recorded member wallet balances · historical and read only" Icon={Wallet} className={`${styles.half} ${styles.goldPanel}`} action={<Link className={styles.textLink} href="/admin/treasury">Open wallet records</Link>}><div className={styles.inset}><span className={styles.fieldLabel}>Recorded wallet total</span><strong className={styles.balance}>{peso(data?.summary.recordedWallets)}</strong><p className={styles.caption}>These are recorded ledger balances, not live financial account balances.</p></div><div className={styles.tableScroll}><table><thead><tr><th>Phone number</th><th>Member ID</th><th>Recorded balance</th></tr></thead><tbody>{data?.recordsHidden ? <tr><td colSpan={3} className={styles.empty}>Wallet records are hidden on this dashboard. Stored records are unchanged.</td></tr> : visible.map(m => <tr key={m.id}><td>{m.phone ?? 'Phone unavailable'}</td><td>{m.id.slice(0,8)}</td><td>{peso(m.recordedBalance)}</td></tr>)}</tbody></table></div></Panel>}
        {activeNav === 'Transactions' && <Panel title="Transaction History" subtitle="Latest recorded wallet transactions" Icon={ReceiptText} className={styles.full} action={<Link className={styles.textLink} href="/admin/money">Open complete transaction records</Link>}><TransactionTable rows={data?.recent ?? []} loading={loading} phone={phone} empty={data?.recordsHidden ? 'Transaction records are hidden on this dashboard. Stored records are unchanged.' : 'No transaction records.'} /></Panel>}
      </div>
      <footer className={styles.footer}>{data ? `Last refreshed ${new Date(data.fetchedAt).toLocaleTimeString()} · Historical wallet records` : 'Sign in as an administrator to load records.'}</footer>
    </main>
  </div>;
}
