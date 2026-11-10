"use client";


import { formatPhp } from '@/lib/format-php';
import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";

import {

  Home, Sprout, Store, UserRound, Users,

  ChevronRight, ShieldCheck,

  Copy, Check,

  UserPlus, RefreshCw, X,

  Gift

} from "lucide-react";

import { supabase } from "@/lib/supabase";
import { moneyRequest } from "@/lib/money-client";
import { productDisplayName, productDisplayImage, productDetails, isCatalogProduct } from '@/lib/product-presentation';
import AureviaLogo from '@/components/AureviaLogo';
import LiveInvestments from "@/components/LiveInvestments";
import BankAccounts from "@/components/BankAccounts";
import MemberAvatar from "@/components/MemberAvatar";
import MemberProfile from "@/components/MemberProfile";
import HomeRewards from "@/components/HomeRewards";
import RealWalletSummary from "@/components/RealWalletSummary";
type Product = {

  id: string;

  name: string;

  description: string | null;

  minimum_amount: number;

  illustrative_return_pct: number;

  duration_days: number;

};

type Profile = {
  invite_code?: string | null;
  short_invite_code?: string | null;

};

type Member = {
  phone_last4?: string | null;
  verified_deposits?: number;
  earned_commission?: number;

  id: string;

  full_name: string | null;

  created_at: string;

};

type TeamSummary = {
  total_commission: number;
  activeFriends: number | null;
  levels: { level: number; count: number; commission: number; members: Member[] }[];
};

type Tab = "home" | "products" | "assets" |

  "team" | "wallet" | "profile" | "tasks" | "bank";

const peso = (value: number) =>

  formatPhp(value);

type DailyTask = { threshold: number; reward: number; active_count: number; claimed: boolean; funded?:boolean };
const TASK_MILESTONES = [
  { threshold: 10, reward: 100 },
  { threshold: 20, reward: 250 },
  { threshold: 30, reward: 400 },
  { threshold: 50, reward: 1500 },
];

export default function HomePage({initialTab="home"}:{initialTab?:Tab}={}) {

  const [checkoutProduct,setCheckoutProduct] = useState<string|null>(null);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [announcementOpen, setAnnouncementOpen] = useState(false);
  const [dailyTasks, setDailyTasks] = useState<DailyTask[]>([]);
  const [walletRevision, setWalletRevision] = useState(0);
  const [tasksBusy, setTasksBusy] = useState(false);
  const [tasksError, setTasksError] = useState("");
  const [tasksLoaded, setTasksLoaded] = useState(false);

  const [products, setProducts] = useState<Product[]>([]);
  const catalogProducts = products.filter(p => isCatalogProduct(p.name)).sort((a, b) =>
    (productDetails(a.name)?.tier ?? Infinity) - (productDetails(b.name)?.tier ?? Infinity)
  );

  const [selectedTeamLevel, setSelectedTeamLevel] = useState<1 | 2 | 3>(1);
  const [teamSummary, setTeamSummary] = useState<TeamSummary | null>(null);

  
  const [userId, setUserId] = useState<string | null>(null);

  const [email, setEmail] = useState("");

  const [verified, setVerified] = useState(false);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [memberName, setMemberName] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);


  const [message, setMessage] = useState("");

  const [copied, setCopied] = useState(false);

  const [inviteLink, setInviteLink] = useState("");
  
useEffect(() => {
  const code = profile?.short_invite_code || profile?.invite_code;
  if (!code) {
    setInviteLink("");
    return;
  }

  const url = new URL("/register", window.location.origin);
  url.searchParams.set("ref", code);

  setInviteLink(url.toString());
}, [profile?.invite_code, profile?.short_invite_code]);

  const loadData = useCallback(async (id: string) => {
    const [catalog, member] = await Promise.all([
      supabase.from("investment_products").select("id,name,price,daily_income,duration_days")
        .order("price", { ascending: true }),
      supabase.from("profiles").select("invite_code,short_invite_code").eq("id", id).maybeSingle(),
    ]);

    if (catalog.error) setMessage("Unable to load Market products.");
    else setProducts((catalog.data ?? []).map(item => ({
      id: item.id,
      name: item.name,
      description: "AUREVIA product plan",
      minimum_amount: Number(item.price),
      illustrative_return_pct: Number(item.price) > 0 ? Number(item.daily_income) / Number(item.price) * 100 : 0,
      duration_days: Number(item.duration_days ?? 365),
    })));

    if (member.error || !member.data) setMessage("Unable to load your member profile.");
    else setProfile(member.data);
  }, []);

  useEffect(() => {
    if (tab !== 'team' || !userId) return;
    let active = true;
    let running = false;
    const refreshTeam = async () => {
      if (running || document.hidden) return;
      running = true;
      try {
        const result = await moneyRequest('/api/team');
        if (!active) return;
        const live = result.team as {total_commission:number;active_friends?:number;levels:{level:number;count:number;commission:number;members:{id:string;created_at:string;phone_last4?:string;deposits:number;commission:number}[]}[]};
        const summary:TeamSummary = {
          total_commission:Number(live.total_commission)/100,
          activeFriends: live.active_friends ?? null,
          levels:live.levels.map(level=>({...level,commission:Number(level.commission)/100,members:level.members.map(member=>({...member,full_name:null,verified_deposits:Number(member.deposits)/100,earned_commission:Number(member.commission)/100}))})),
        };
        setTeamSummary(summary);

      } catch {
        if (active) setMessage('Unable to refresh your team. Please try again.');
      } finally { running = false; }
    };
    void refreshTeam();
    const timer = window.setInterval(() => void refreshTeam(), 30000);
    window.addEventListener('focus', refreshTeam);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', refreshTeam); };
  }, [tab, userId]);

  useEffect(() => {

    async function initialize() {

      try {

        const { data, error } = await supabase.auth.getUser();

        if (error?.name === "AuthSessionMissingError" || (!error && !data.user)) {
          window.location.replace("/login");
          return;
        }

        if (error) throw error;

        if (!data.user) {

          setMessage("Please sign in to continue.");

          return;

        }

        const user = data.user;
        const name = user.user_metadata?.display_name || user.user_metadata?.full_name;
        setMemberName(typeof name === "string" ? name : null);

        setUserId(user.id);

        setEmail(user.phone ?? user.email ?? "");

        setVerified(Boolean(user.phone_confirmed_at ?? user.email_confirmed_at));
        setLoading(false);
        await loadData(user.id);

      } catch (error) {

        setMessage(

          error instanceof Error ? error.message : "Unable to load."

        );

      } finally {

        setLoading(false);

      }

    }

    initialize();

  }, [loadData]);

  useEffect(() => {
    if (tab === "home" && userId) setAnnouncementOpen(true);
  }, [tab, userId]);

  useEffect(() => {
    if (!announcementOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAnnouncementOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [announcementOpen]);

  const loadDailyTasks = useCallback(async () => {
    setTasksBusy(true);
    setTasksError("");
    try {
      const result=await moneyRequest('/api/daily-tasks');
      setDailyTasks((result.tasks ?? []).map((task:DailyTask)=>({...task,reward:Number(task.reward)/100})));
      setTasksLoaded(true);
    } catch(error){setTasksError(error instanceof Error?error.message:'Unable to load daily tasks');setTasksLoaded(false);}
    setTasksBusy(false);
  }, []);

  useEffect(() => {
    if (tab === "tasks" && userId) void loadDailyTasks();
  }, [tab, userId, loadDailyTasks]);

  async function claimDailyTask(threshold: number) {
    if (tasksBusy) return;
    setTasksBusy(true);
    setTasksError("");
    try {await moneyRequest('/api/daily-tasks',{threshold});}
    catch(error){setTasksError(error instanceof Error?error.message:'Unable to confirm claim');}

    await loadDailyTasks();
  }

  function navigateTab(nextTab: Tab) {
    setTab(nextTab);
    window.scrollTo({ top: 0 });
  }

  async function copyInvite() {

    if (!inviteLink) return;

    try {

      await navigator.clipboard.writeText(inviteLink);

      setCopied(true);

    } catch {

      setMessage("Unable to copy invitation link.");

    }

  }

  async function logout() {

    const { error } = await supabase.auth.signOut();

    if (error) {

      setMessage(error.message);

      return;

    }

    window.location.replace("/login");
  }
  
  
    const getProduct = (id: string) =>

    products.find(p => String(p.id) === String(id));

  const peopleInTeam = teamSummary?.levels.reduce((total, tier) => total + tier.count, 0);
  const currentTeamLevel = teamSummary?.levels.find(level => level.level === selectedTeamLevel);
  const currentTeamMembers = currentTeamLevel?.members ?? [];

  if (loading) {

    return (

      <main className="loading">

        Loading AUREVIA...

      </main>

    );

  }

  if (!userId) {

    return (

      <main className="loading">

        <h1>AUREVIA</h1>

        <p>{message || "Please sign in."}</p>

        <a href="/login">Go to Login</a>

      </main>

    );

  }

  return (

    <div className="UNIFY-app">

      <header className="UNIFY-header">

        <div className="brand">

          <AureviaLogo className="aurevia-header-logo" />

          <div>

            <h1>AUREVIA</h1>
          </div>

        </div>

        <div className="label">

          <ShieldCheck size={15} />

        </div>

      </header>

      <main className="UNIFY-main">
        {message && (

          <div className="notice" role="status">

            {message}

            <button

              type="button"

              onClick={() => setMessage("")}

              aria-label="Dismiss message"

            >

              <X size={16} />

            </button>

          </div>

        )}

        {/* HOME */}

        {tab === "home" && (

          <section className="home-dashboard" aria-label="Home">
            <RealWalletSummary homeCard key={walletRevision} />



            <HomeRewards onTasks={() => navigateTab("tasks")} onClaim={() => setWalletRevision(revision => revision + 1)} />

            <div className="section-heading">

              <h3>Recommended Tier</h3>

              <button onClick={() => navigateTab("products")}>

                View All <ChevronRight size={17} />

              </button>

            </div>

            <div className="product-grid">

              {catalogProducts.filter(product => (productDetails(product.name)?.tier ?? Infinity) <= 3).map(product => (

                <ProductCard

                  key={product.id}

                  product={product}

                  onInvest={() => setCheckoutProduct(product.id)}

                />

              ))}

            </div>

          </section>

        )}

{/* DAILY TASKS */}
{tab === "tasks" && (
  <section className="unify-daily-tasks">
    <div className="page-heading">
      <h2>Lifetime Tasks</h2>
      <p>Team milestones based on lifetime progress.</p>
    </div>
    <div className="unify-task-info">
      <Users size={22} />
      <div>
        <strong>{dailyTasks[0]?.active_count ?? 0} direct members with a paid tier</strong>
        <p>Each direct invite counts once after their first paid tier. Claim each funded milestone once to receive the reward in your available balance.</p>
      </div>
    </div>
    
    {tasksError && <div className="notice" role="alert">{tasksError}</div>}
    <div className="unify-task-list">
      {TASK_MILESTONES.map(({ threshold, reward }) => {
        const item = dailyTasks.find(t => Number(t.threshold) === threshold);
        const count = Number(item?.active_count ?? 0);
        const claimed = Boolean(item?.claimed);
        const unlocked = count >= threshold;
        return (
          <div className="unify-task-card" key={threshold}>
            <div className="unify-task-icon"><Gift size={23} /></div>
            <div className="unify-task-description">
              <strong>{threshold} direct members with paid tiers</strong>
              <span>{unlocked ? "Milestone unlocked" : `${Math.max(0, threshold - count)} more to unlock`}</span>
              <div className="unify-task-progress"><div style={{width: `${Math.min(100, count / threshold * 100)}%`}} /></div>
            </div>
            <div className="unify-task-reward">
              <strong>{peso(reward)}</strong>
              <button
                type="button"
                disabled={!tasksLoaded || tasksBusy || !unlocked || claimed || item?.funded === false}
                onClick={() => claimDailyTask(threshold)}
              >
                {claimed ? "Claimed" : unlocked ? item?.funded === false ? "Awaiting funding" : "Claim" : "Locked"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
    <button className="unify-task-refresh" type="button" disabled={tasksBusy} onClick={loadDailyTasks}>
      <RefreshCw size={16} /> {tasksBusy ? "Loading..." : "Refresh tasks"}
    </button>
    <button type="button" className="invest-now-button" onClick={() => navigateTab("home")}>Back to Home</button>
   
  </section>
)}

{/* BANK ACCOUNT */}
{tab === "bank" && <BankAccounts onBack={() => setTab("profile")} />}

        {/* PRODUCTS */}

        {tab === "products" && (

          <>

            <div className="page-heading">

              <h2>Market</h2>

            </div>

            <div className="product-grid">

              {catalogProducts.map(product => (

                <ProductCard

                  key={product.id}

                  product={product}

                  onInvest={() => setCheckoutProduct(product.id)}

                />

              ))}

              {products.length === 0 && (

                <div className="empty-state">

                </div>

              )}

            </div>

          </>

        )}

        {/* ASSETS */}

        {tab === "assets" && <LiveInvestments view="portfolio" />}

        {/* TEAM */}

        {tab === "team" && (

          <div className="team-page">

            <div className="page-heading">

              <h2>Friends</h2>
            </div>

            <section className="home-wallet" aria-label="Team earnings" aria-busy={!teamSummary}>
              <div className="home-wallet-label">Team earnings</div>
              <h2>{teamSummary ? peso(teamSummary.total_commission) : '—'}</h2>
              <dl className="home-wallet-breakdown">
                <div><dt>People in your team</dt><dd>{peopleInTeam ?? '—'}</dd></div>
                <div><dt>Active friends</dt><dd>{teamSummary?.activeFriends ?? '—'}</dd><small>Tier 1 with a completed deposit</small></div>
              </dl>
            </section>

            <section className="team-panel aurevia-invite" aria-labelledby="invite-heading">
              <h3 id="invite-heading">Invite friends</h3>
              <label className="aurevia-invite-label" htmlFor="team-invite-link">Your invite link</label>
              <div className="aurevia-invite-controls">
                <input id="team-invite-link" readOnly value={inviteLink}
                  placeholder="Invite link unavailable" onFocus={event => event.currentTarget.select()} />
                <button type="button" className="invite-button" onClick={copyInvite} disabled={!inviteLink}>
                  {copied ? <Check size={18} /> : <Copy size={18} />}
                  {copied ? "Copied!" : "Copy link"}
                </button>
              </div>
              <span className="sr-only" role="status">{copied ? "Invite link copied" : ""}</span>
            </section>

            <section className="team-members unify-level-members">
              <div className="section-heading">
                <h3>Members</h3>
                <span>Commission rates</span>
              </div>
              <div className="unify-level-tabs" role="group" aria-label="Referral tier">
                {([1, 2, 3] as const).map((level) => (
                  <button
                    key={level}
                    type="button"
                    className={selectedTeamLevel === level ? "active" : ""}
                    aria-pressed={selectedTeamLevel === level}
                    onClick={() => setSelectedTeamLevel(level)}
                  >
                    Tier {level} · {level === 1 ? 18 : level === 2 ? 3 : 1}%
                  </button>
                ))}
              </div>
              <div className="unify-level-meta">
                <span>Tier {selectedTeamLevel}</span>
              </div>
              {!teamSummary ? (
                <p role="status">Loading team members…</p>
              ) : currentTeamMembers.length === 0 ? (
                <div className="team-empty">
                  <UserPlus size={36} />
                  <h3>No Tier {selectedTeamLevel} members yet</h3>
                 
                </div>
              ) : (
                currentTeamMembers.map((member) => (
                  <div className="friend-list-row" key={member.id}>
                    <MemberAvatar />
                    <div className="friend-list-identity">
                      <strong>{member.phone_last4 ? `•••• ${member.phone_last4}` : '—'}</strong>
                      <span>Joined {new Date(member.created_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}</span>
                      <span>{Number(member.verified_deposits) > 0 ? `Deposits ${peso(Number(member.verified_deposits))}` : 'No completed deposit'}</span>
                    </div>
                    <div className="friend-list-earned">
                      <span>You earned</span>
                      <strong>{peso(Number(member.earned_commission ?? 0))}</strong>
                    </div>
                  </div>
                ))
              )}
            
            </section>

          </div>

        )}

        {/* WALLET */}

        {tab === "wallet" && (

          <>

            <div className="page-heading">

              <h2>Wallet</h2>

              <p>funds and transaction history.</p>

            </div>

            <RealWalletSummary />

            <Link href="/money">View wallet transaction history</Link>

          </>

        )}

        {tab === "profile" && (
          <MemberProfile contact={email} name={memberName} verified={verified}
            onBank={() => navigateTab("bank")} onLogout={logout} />
        )}

      </main>
    
      {checkoutProduct && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-[#23102e]/70 p-3 sm:p-4">
          <div className="max-h-[calc(100dvh-1.5rem)] w-full max-w-sm overflow-y-auto rounded-3xl border border-[#eadff0] bg-[#faf5fb] p-3 shadow-xl sm:p-4"
            role="dialog" aria-modal="true" aria-label="Confirm product purchase">
            <button type="button" className="mb-2 min-h-9 text-sm font-semibold text-[#54265e]" onClick={() => setCheckoutProduct(null)}>
              ← Back to {tab === "products" ? "Market" : "Home"}
            </button>
            <LiveInvestments view="checkout" selectedProductId={checkoutProduct} onPurchased={() => {
              setCheckoutProduct(null);
              setTab("assets");
            }} />
          </div>
        </div>
      )}

      {announcementOpen && tab === "home" && (
        <div
          className="aurevia-announcement-overlay"
          onMouseDown={event => {
            if (event.target === event.currentTarget) setAnnouncementOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="aurevia-announcement-title"
            className="aurevia-announcement"
          >
            <button
              type="button"
              onClick={() => setAnnouncementOpen(false)}
              className="aurevia-announcement-close"
              aria-label="Close announcement"
            >
              <X size={19} />
            </button>
            <div className="aurevia-announcement-icon">
              <Image src="/aurevia-icon.png" alt="AUREVIA logo" width={64} height={64} priority />
            </div>
            <p className="aurevia-announcement-eyebrow">AUREVIA COMMUNITY</p>
            <h2 id="aurevia-announcement-title" className="aurevia-announcement-title">
              Official Announcement
            </h2>
            <p className="aurevia-announcement-description">
              Check back here for official AUREVIA links.
            </p>

            <div className="aurevia-announcement-links">
              <div className="aurevia-announcement-link">
                <span>
                  <span className="aurevia-announcement-link-label">OFFICIAL WEBSITE</span>
                  <span className="aurevia-announcement-url">Coming soon</span>
                </span>
                <span className="aurevia-announcement-badge">SOON</span>
              </div>
              <div className="aurevia-announcement-link aurevia-announcement-telegram">
                <span>
                  <span className="aurevia-announcement-link-label">TELEGRAM GROUP CHAT</span>
                  <span className="aurevia-announcement-url">Official group coming soon</span>
                </span>
                <span className="aurevia-announcement-badge">SOON</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setAnnouncementOpen(false)}
              className="aurevia-announcement-dismiss"
            >
              Close
            </button>
          </section>
        </div>
      )}
      {/*  TRANSACTION  */}

      {/* BOTTOM NAVIGATION */}

{/* BOTTOM NAVIGATION */}

<nav className="bottom-nav" aria-label="Main navigation">

  {[

    { id: "home" as Tab, icon: Home, label: "Home" },

    { id: "assets" as Tab, icon: Sprout, label: "My Tier" },

    { id: "products" as Tab, icon: Store, label: "Market" },

    { id: "team" as Tab, icon: Users, label: "Friends" },

    { id: "profile" as Tab, icon: UserRound, label: "Profile" }

  ].map(item => {

    const Icon = item.icon;

    return (

      <button

        key={item.id}

        className={tab === item.id ? "active" : ""}

        type="button"
        aria-current={tab === item.id ? "page" : undefined}
        onClick={() => navigateTab(item.id)}

      >

        <Icon size={24} />

        <span>{item.label}</span>

      </button>

    );

  })}

</nav>

    </div>

  );

}

const productImages: Record<string, string> = {

  "G5 Flex Camera": "/products/G5 Flex Camera.jpg",

  "G5 Dome Camera": "/products/G5 Dome Camera.jpg",

  "G5 Bullet Camera": "/products/G5 Bullet Camera.jpg",

  "UniFi U6 Pro AP": "/products/UniFi U6 Pro AP.jpg",

  "G4 Doorbell Pro": "/products/G4 Doorbell Pro.jpg",

  "UNVR 4-Bay NVR": "/products/UNVR 4-Bay NVR.jpg",

  "G5 Pro 4K Camera": "/products/G5 Pro 4K Camera.jpg",

  "UDM Pro Gateway": "/products/UDM Pro Gateway.jpg",

};

function ProductCard({ product, onInvest }: { product: Product; onInvest: () => void }) {
  const amount = Number(product.minimum_amount);
  const earnings = amount * Number(product.illustrative_return_pct) / 100;
  const detail = productDetails(product.name);
  const rewardDays = product.duration_days;
  return (
    <article className="investment-card aurevia-world-card">
      <img className="world-product-image" src={productDisplayImage(product.name)} alt={productDisplayName(product.name)} />
      <div className="world-product-body">
        <div className="world-product-heading">
          <div><p className="world-country">{detail?.country ?? 'AUREVIA'} · TIER {detail?.tier ?? '—'}</p><h3>{productDisplayName(product.name)}</h3></div>
          <span className="world-mascot" aria-hidden="true">
            <svg viewBox="0 0 72 80" width="60" height="67" fill="none">
              <ellipse cx="23" cy="23" rx="8" ry="21" transform="rotate(-18 23 23)" fill="#fdfaf9" />
              <ellipse cx="49" cy="23" rx="8" ry="21" transform="rotate(18 49 23)" fill="#fdfaf9" />
              <ellipse cx="23" cy="23" rx="4" ry="15" transform="rotate(-18 23 23)" fill="#e9a9b1" />
              <ellipse cx="49" cy="23" rx="4" ry="15" transform="rotate(18 49 23)" fill="#e9a9b1" />
              <ellipse cx="36" cy="53" rx="30" ry="24" fill="#fffdf9" />
              <ellipse cx="25" cy="51" rx="3.5" ry="4.5" fill="#4d2059" />
              <ellipse cx="47" cy="51" rx="3.5" ry="4.5" fill="#4d2059" />
              <ellipse cx="19" cy="61" rx="6" ry="3" fill="#f5c5d3" />
              <ellipse cx="53" cy="61" rx="6" ry="3" fill="#f5c5d3" />
              <path d="M32 59q4 5 8 0" stroke="#4d2059" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            <span className="world-symbol">{detail?.symbol}</span>
          </span>
        </div>
        <p className="world-description">{detail?.description ?? product.description}</p>
        <div className="world-amounts">
          <div><strong>{peso(amount)}</strong><span>ENTRY</span></div>
          <div><strong>{peso(earnings)}</strong><span>PER DAY</span></div>
          <div><strong>{peso(earnings * rewardDays)}</strong><span>TOTAL INCOME</span></div>
        </div>
        <p className="world-duration">{rewardDays}-day plan</p>
        <button type="button" className="invest-now-button" onClick={onInvest}>Start Investment <ChevronRight size={20} /></button>
      </div>
    </article>
  );
}
