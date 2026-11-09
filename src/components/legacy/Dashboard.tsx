"use client";


import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

import {

  Home, Sprout, Store, Wallet, UserRound, Users, ExternalLink,

  ArrowUpFromLine, TrendingUp,

  ChevronRight, ShieldCheck,

  Copy, Check, History,

  UserPlus, RefreshCw, X, CheckCircle2,

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

type Investment = {
  acquisition_type?: string;

  id: string;

  amount: number;

  status: string;

  daily_income: number;

  created_at: string;

  product_id: string;

};

type Transaction = {

  id: number;

  type: string;

  amount: number;

  created_at: string;

};

type Profile = {

  full_name: string | null;

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

type ActionKind = "deposit" | "withdrawal" | "investment";
type TeamSummary = {
  total_commission: number;
  activeFriends: number | null;
  levels: { level: number; count: number; commission: number; members: Member[] }[];
};

type Tab = "home" | "products" | "assets" |

  "team" | "wallet" | "profile" | "tasks" | "bank";

const peso = (value: number) =>

  new Intl.NumberFormat("en-PH", {

    style: "currency",

    currency: "PHP"

  }).format(value);

type PaymentTransaction = {

  id: string;

  user_id: string;

  transaction_type: "deposit" | "withdrawal";

  amount: number;

  currency: string;

  status: string;

  provider: string;

  created_at: string;

};

type HistoryEntry = {
  id: string;
  label: string;
  amount: number;
  status: string;
  created_at: string;
  isCredit: boolean;
};

function PaymentHistory({ entries }: { entries: HistoryEntry[] }) {
  return (
    <section className="unify-payment-history" aria-label={`Payment history: ${entries.length} transactions`}>
      <div className="wallet-history-header">
        <div>
          <h4>Payment History</h4>
          <p>All your wallet and payment transactions</p>
        </div>
        <a href="/deposit/history" className="deposit-history-link">Show all deposits <ChevronRight size={16} /></a>
      </div>
    </section>
  );
}

type SimCredit = { investment_id: string; day_number: number };
const DAY_MS = 86400000;
type DailyTask = { threshold: number; reward: number; active_count: number; claimed: boolean; funded?:boolean };
const TASK_MILESTONES = [
  { threshold: 10, reward: 100 },
  { threshold: 20, reward: 250 },
  { threshold: 30, reward: 400 },
  { threshold: 50, reward: 1500 },
];

export default function HomePage({initialTab="home",simulationArchive=false}:{initialTab?:Tab;simulationArchive?:boolean}={}) {
  const router = useRouter();

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

  const [investments, setInvestments] = useState<Investment[]>([]);
  const [claimedByInvestment,setClaimedByInvestment] = useState<Record<string,number>>({});
  const [claimBusy,setClaimBusy] = useState<string|null>(null);
  const [claimFeedback,setClaimFeedback] = useState("");
  const [clockNow,setClockNow] = useState(() => Date.now());
  useEffect(() => {const timer=window.setInterval(()=>setClockNow(Date.now()),1000);return ()=>window.clearInterval(timer);},[]);

  const [transactions, setTransactions] = useState<Transaction[]>([]);


  const [selectedTeamLevel, setSelectedTeamLevel] = useState<1 | 2 | 3>(1);
  const [teamSummary, setTeamSummary] = useState<TeamSummary | null>(null);

  
  const [balance, setBalance] = useState(0);
  const [remainingBalance, setRemainingBalance] = useState(0);
  const [claimedTotal, setClaimedTotal] = useState<number | null>(null);
  // Display the existing recorded wallet balance.
  // This is a temporary read-only display mapping; do not credit funds here.
  const purchaseBalance = (Math.round(remainingBalance * 100) + Math.round(balance * 100)) / 100;
  

  const [userId, setUserId] = useState<string | null>(null);

  const [email, setEmail] = useState("");

  const [verified, setVerified] = useState(false);

  const [profile, setProfile] = useState<Profile | null>(null);

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

  // Payment transactions

  const [paymentTransactions, setPaymentTransactions] =

  useState<PaymentTransaction[]>([]);

const loadWalletData = useCallback(async (userId: string) => {
  const { data, error } = await supabase
    .from("payment_transactions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("Transaction loading error:", error.message);
  } else {
    setPaymentTransactions((data ?? []) as PaymentTransaction[]);
  }
}, []);

  const loadSimulationClaims = useCallback(async (id:string) => {
    const [wallet,credits] = await Promise.all([
      supabase.from("sandbox_wallets").select("remaining_balance").eq("user_id",id).maybeSingle(),
      supabase.from("simulation_daily_credits").select("investment_id,day_number,amount").eq("user_id",id)
    ]);
    if(wallet.error || credits.error){setClaimFeedback(wallet.error?.message ?? credits.error?.message ?? "Claims unavailable");return;}
    if (!wallet.data || !Number.isFinite(Number(wallet.data.remaining_balance))) {
      setClaimFeedback("Unable to confirm your test wallet balance.");
      return;
    }
    setRemainingBalance(Number(wallet.data.remaining_balance));
    setClaimedTotal((credits.data ?? []).reduce((sum, credit) => sum + Math.round(Number(credit.amount) * 100), 0) / 100);

    const counts:Record<string,number>={};
    for(const c of (credits.data ?? []) as SimCredit[]) counts[c.investment_id]=(counts[c.investment_id]??0)+1;
    setClaimedByInvestment(counts);
  },[]);

  async function claimInvestmentDays(investmentId:string){
    if(!userId || claimBusy) return;
    setClaimBusy(investmentId);setClaimFeedback("");
    try{
      const {data,error}=await supabase.rpc("claim_simulation_days",{p_investment_id:investmentId});
      if(error)throw new Error(error.message);
      await loadSimulationClaims(userId);
      const result=data as {claimed_days?:number;credited?:number}|null;
      setClaimFeedback(
  result?.claimed_days
    ? `Claimed ${result.claimed_days} simulated day(s): ${peso(
        Number(result.credited ?? 0)
      )}. Added to Remaining Balance (Test Mode).`
    : "No new simulated days available."
);
    }catch(e){setClaimFeedback(e instanceof Error?e.message:"Claim failed");}
    finally{setClaimBusy(null);}
  }

  const [actionKind, setActionKind] =

    useState<ActionKind | null>(null);

  const [selectedProduct, setSelectedProduct] =

    useState<Product | null>(null);

  const [actionAmount, setActionAmount] = useState("");

  const [actionBusy, setActionBusy] = useState(false);

  const loadData = useCallback(async (id: string) => {

  const [p, i, t, b, pr] = await Promise.all([

    supabase

      .from("investment_products")

      .select("*")

      .order("price", { ascending: true }),

    supabase.from("demo_investments")

        .select("*")

        .eq("user_id", id)

        .order("created_at", { ascending: false }),

      supabase.from("transactions")

        .select("*")

        .eq("user_id", id)

        .order("created_at", { ascending: false }),

      supabase
        .from("wallet_accounts")
        .select("balance, currency")
        .eq("user_id", id)
        .maybeSingle(),

      supabase.from("profiles")

        .select("*")

        .eq("id", id)

        .maybeSingle(),

    ]);

    // Core wallet and investment queries must succeed.

const results = {

  products: p.error,

  investments: i.error,

  transactions: t.error,

  balance: b.error,

  profile: pr.error,



};

Object.entries(results).forEach(([name, error]) => {

  if (error) {

    console.warn(`${name} query failed`, {

      message: error.message,

      code: error.code,

      details: error.details,

      hint: error.hint,

    });

  }

});

if (p.error) {

  throw new Error(`Products: ${p.error.message}`);

}

const requiredError = [i.error, t.error, b.error].find(Boolean);

if (requiredError) {

  console.warn("Required data failed:", {

    message: requiredError.message,

    code: requiredError.code,

    details: requiredError.details,

  });

}

  setProducts((p.data ?? []).map((item) => ({

    id: item.id,

    name: item.name,

    description: "AUREVIA product plan",

    minimum_amount: Number(item.price),

    illustrative_return_pct:

      Number(item.price) > 0

        ? (Number(item.daily_income) / Number(item.price)) * 100

        : 0,

    duration_days: Number(item.duration_days ?? 365),

  })) as Product[]);

  // The sandbox purchase RPC writes to demo_investments.
  // This table has no status column, so use a display-only label.
  if (i.error) {
    setMessage(`Unable to load your portfolio: ${i.error.message}`);
  } else {
    setInvestments((i.data ?? []).map((row) => ({
      id: String(row.id),
      product_id: String(row.product_id),
      amount: Number(row.amount),
      daily_income: Number(row.daily_income ?? 0),
      acquisition_type: row.acquisition_type ?? 'purchase',
      created_at: String(row.created_at),
      status: "Simulated purchase",
    })));
  }

  setTransactions((t.data ?? []) as Transaction[]);
  
if (b.error) {
    console.error("AUREVIA balance error:", {
      message: b.error.message,
      code: b.error.code,
      details: b.error.details,
      hint: b.error.hint,
    });
    setMessage("Unable to load your wallet balance. Please refresh.");
  } else if (b.data) {
    setBalance(Number(b.data.balance));
  } else {
    console.warn("AUREVIA wallet account not found for user:", id);
    setMessage("Wallet account not found. Please contact support.");
  }
  // Remaining Balance stays separate from the existing deposit wallet.
  const sandboxWalletResult = await supabase.from("sandbox_wallets")
    .select("remaining_balance")
    .eq("user_id", id)
    .maybeSingle();

  if (sandboxWalletResult.error) {
    console.error("Sandbox wallet error:", sandboxWalletResult.error);
    setMessage(`Unable to load test balance: ${sandboxWalletResult.error.message}`);
  } else if (!sandboxWalletResult.data) {
    console.warn("No sandbox wallet found for:", id);
    setMessage("Your test wallet was not found. Contact support.");
  } else {
    const amount = Number(sandboxWalletResult.data.remaining_balance);
    if (!Number.isFinite(amount)) {
      setMessage("Invalid test wallet balance received.");
    } else {
      setRemainingBalance(amount);
      console.log("AUREVIA test balance loaded:", amount);
    }
  }

  if (pr.error) {
    console.error("AUREVIA profile error:", pr.error);
    setMessage(`Profile loading failed: ${pr.error.message}`);
  } else if (!pr.data) {
    setProfile(null);
    setMessage("Member profile not found.");
  } else {
    const memberProfile = pr.data as Profile;
    setProfile(memberProfile);
    console.log("AUREVIA profile loaded:", {
      hasInviteCode: Boolean(memberProfile.invite_code),
    });
  }



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

        setUserId(user.id);

        setEmail(user.phone ?? user.email ?? "");

        setVerified(Boolean(user.phone_confirmed_at ?? user.email_confirmed_at));

        await loadData(user.id);

        await loadWalletData(user.id);
        await loadSimulationClaims(user.id);

      } catch (error) {

        setMessage(

          error instanceof Error ? error.message : "Unable to load."

        );

      } finally {

        setLoading(false);

      }

    }

    initialize();

  }, [loadData, loadWalletData, loadSimulationClaims]);

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

  async function refreshData() {

    if (!userId) return;

  

    try {

      await loadData(userId);
        await loadWalletData(userId);
        await loadSimulationClaims(userId);

      setMessage("");

    } catch (error) {

      setMessage(

        error instanceof Error ? error.message : "Refresh failed."

      );

    } finally {

    

    }

  }

  function navigateTab(nextTab: Tab) {
    setTab(nextTab);
    window.scrollTo({ top: 0 });
  }

  function openAction(

    kind: ActionKind,

    product?: Product

  ) {

    if (kind === "investment") {
      if(product){setCheckoutProduct(product.id);}else{setTab("home");}
      return;
    }

    if (kind === "deposit") {
      router.push("/deposit");
      return;
    }

    setActionKind(kind);

    setSelectedProduct(product ?? null);

    setActionAmount(

      product ? String(product.minimum_amount) : ""

    );

    setMessage("");

  }

  function closeAction() {

    if (actionBusy) return;

    setActionKind(null);

    setSelectedProduct(null);

    setActionAmount("");

  }

  async function submitAction() {

    if (!actionKind || !userId || actionBusy) return;

    const amount = Number(actionAmount);

    if (

      !Number.isFinite(amount) ||

      amount < 0.01 ||

      amount > 100000 ||

      Math.round(amount * 100) !== amount * 100

    ) {

      setMessage("Enter a valid amount from ₱0.01 to ₱100,000.");

      return;

    }

    if (

      actionKind === "investment" &&

      (!selectedProduct ||

        amount < Number(selectedProduct.minimum_amount))

    ) {

      setMessage("Amount is below the product minimum.");

      return;

    }

    if (

      actionKind !== "deposit" &&

      amount > (actionKind === "investment" ? purchaseBalance : balance)

    ) {

      setMessage(actionKind === "investment" ? "Insufficient combined test balance (Remaining + Deposit)." : "Insufficient balance.");

      return;

    }

    // Never credit or debit real-money wallets through the legacy my_action RPC.
    if (actionKind === "deposit") {
      setActionKind(null);
      router.push("/deposit");
      return;
    }

    if (actionKind === "withdrawal") {
      setMessage("Withdrawals require an approved payout integration. No funds were moved.");
      return;
    }

    setActionBusy(true);

    setMessage("");

    try {

      if (actionKind === "investment") {
        if (!selectedProduct?.id) {
          throw new Error("Please select an investment product.");
        }

        throw new Error("Use the live product purchase page. No funds were moved.");
      } else {
        const { error } = await supabase.rpc("my_action", {
          p_kind: actionKind,
          p_amount: amount,
          p_product_id: null,
        });

        if (error) throw error;
      }

      const completedKind = actionKind;

      setActionKind(null);

      setSelectedProduct(null);

      setActionAmount("");

      await loadData(userId);
        await loadWalletData(userId);
        await loadSimulationClaims(userId);

      setMessage(

        "Your transaction was completed successfully."

      );

      if (completedKind === "investment") {

        setTab("assets");

      } else {

        setTab("wallet");

      }

    } catch (error) {

      setMessage(

        error instanceof Error

          ? error.message

          : "transaction failed."

      );

    } finally {

      setActionBusy(false);

    }

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

  // Only a projection: never label this as earnings already received.
  const projected = investments.reduce(
    (sum, inv) => sum + Number(inv.daily_income),
    0
  );

  // Combine transaction sources for payment history.
  const allPaymentHistory: HistoryEntry[] = [
    ...transactions.map((tx) => ({
      id: `ledger-${tx.id}`,
      label: tx.type === "deposit" ? "Deposit" :
        tx.type === "withdrawal" ? "Withdrawal" :
        tx.type === "investment" ? "Investment" :
        tx.type === "return" ? "Return" : tx.type,
      amount: Number(tx.amount),
      status: "Recorded",
      created_at: tx.created_at,
      isCredit: tx.type === "deposit" || tx.type === "return",
    })),
    ...paymentTransactions.map((tx) => ({
      id: `payment-${tx.id}`,
      label: tx.transaction_type === "deposit" ? "Deposit" : "Withdrawal",
      amount: Number(tx.amount),
      status: tx.status,
      created_at: tx.created_at,
      isCredit: tx.transaction_type === "deposit",
    })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

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

                  onInvest={() => openAction("investment", product)}

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

                  onInvest={() => openAction("investment", product)}

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

        {tab === "assets" && !simulationArchive && <LiveInvestments view="portfolio"/>}
        {tab === "assets" && simulationArchive && (

          <>

            <div className="page-heading">

              <h2>My Portfolio</h2>

              <p>Track your investments.</p>

            </div>

            <div className="portfolio-summary">

              <span>Remaining Balance · Test Mode</span>

              <h2>{peso(remainingBalance)}</h2>

              <small>Illustrative daily projection: {peso(projected)}. Unclaimed projections are not included in this balance.</small>
              <small>Daily credits claimed so far: {claimedTotal === null ? '—' : peso(claimedTotal)}. These are included in your test balance.</small>
              <small>Includes the one-time ₱30 registration bonus and other test wallet activity.</small>
              <small>Simulation only — no real earnings.</small></div>
              {claimFeedback && <p role="status">{claimFeedback}</p>}


            {investments.length === 0 && (
              <div className="empty-state">
                <p>No simulated purchases found in your portfolio.</p>
                <button type="button" onClick={refreshData}>
                  Refresh Portfolio
                </button>
              </div>
            )}

            <div className="product-grid">

              {investments.map(inv => {

                const product = getProduct(inv.product_id);

                const start = new Date(inv.created_at);

                const duration = product?.duration_days ?? 100;

                const elapsed = Math.max(

                  0,

                  Math.floor(

                    (Date.now() - start.getTime()) / 86400000

                  )

                );

                const progress = duration

                  ? Math.min(100, elapsed / duration * 100)

                  : 0;

                const eligibleDays=Math.min(365,Math.max(0,Math.floor((clockNow-start.getTime())/DAY_MS)));
                const alreadyClaimed=claimedByInvestment[inv.id]??0;
                const availableDays=Math.max(0,eligibleDays-alreadyClaimed);
                const claimFinished=eligibleDays>=365 && availableDays===0;
                const earnings = Number(inv.daily_income);

                const productName = product?.name ?? "Investment";

                return (

                  <div className="investment-card" key={inv.id}>

                    <div className="card-top">

                      <div className="product-image-box">

                        {productImages[productName] ? (

                          <img

                            src={productDisplayImage(productName)}

                            alt={productDisplayName(productName)}

                            className="product-image"

                          />

                        ) : (

                          <TrendingUp size={25} />

                        )}

                      </div>

                      <div>

                        <h3>

                          {productDisplayName(productName)}

                        </h3>

                        <strong>

                          {inv.acquisition_type === 'admin_free_plan' ? 'Free welcome plan' : peso(Number(inv.amount))}

                        </strong>

                      </div>

                      <span className="duration-badge">

                        {Math.min(elapsed, duration)}/{duration} days

                      </span>

                    </div>

                  <div className="product-stats">

                    <div>

                      <span>Illustrative Daily Amount</span>

                    <strong className="green">

                      {peso(earnings)}

                    </strong>

                     </div>

                    </div>

                    <div className="progress-track">

                      <div style={{ width: `${progress}%` }} />

                    </div>

                    <button type="button" className="invest-now-button" disabled={claimBusy!==null || availableDays===0}
                      onClick={()=>void claimInvestmentDays(inv.id)}>
                      {claimBusy===inv.id?"Claiming...":availableDays>0?`Claim ${peso(availableDays*earnings)} (simulation)`:claimFinished?"Simulation completed":"Claim locked · wait 24 hours"}
                    </button>
                    <p className="simulation-note">Simulated credits only. Not real earnings or withdrawable funds.</p>
                    <p className="simulation-note">

                      {inv.status}
                    </p>

                  </div>

                );

              })}

            </div>

          </>

        )}

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

              <PaymentHistory entries={allPaymentHistory} />

          </>

        )}

        {tab === "profile" && (
          <MemberProfile contact={email} name={profile?.full_name} verified={verified}
            onBank={() => navigateTab("bank")} onLogout={logout} />
        )}

      </main>
    
      {checkoutProduct && <div className="fixed inset-0 z-[100] overflow-y-auto bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Confirm product purchase"><div className="mx-auto my-6 max-w-xl rounded-2xl border border-slate-700 bg-[#0b1320] p-5"><button className="mb-4 text-cyan-300" onClick={()=>setCheckoutProduct(null)}>← Back to {tab === "products" ? "Market" : "Home"}</button><LiveInvestments view="checkout" selectedProductId={checkoutProduct} onPurchased={()=>{setCheckoutProduct(null);setTab("assets");}}/></div></div>}

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
              Please use our official website and share it with current and prospective members.
            </p>

            <div className="aurevia-announcement-links">
              <a
                href="https://bydmch.cyou/login"
                target="_blank"
                rel="noopener noreferrer"
                className="aurevia-announcement-link"
              >
                <span>
                  <span className="aurevia-announcement-link-label">OFFICIAL WEBSITE</span>
                  <span className="aurevia-announcement-url">https://bydmch.cyou/login</span>
                </span>
                <ExternalLink size={17} aria-hidden="true" />
              </a>
              <div className="aurevia-announcement-link aurevia-announcement-telegram">
                <span>
                  <span className="aurevia-announcement-link-label">TELEGRAM GROUP CHAT</span>
                  <span className="aurevia-announcement-url">Official group coming soon</span>
                </span>
                <span className="aurevia-announcement-badge">SOON</span>
              </div>
            </div>

            <a
              href="https://bydmch.cyou/login"
              target="_blank"
              rel="noopener noreferrer"
              className="aurevia-announcement-primary"
            >
              <ExternalLink size={17} aria-hidden="true" />
              Open Official Website
            </a>
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

      {actionKind && actionKind !== "deposit" && (

        <div

          className="modal-overlay unify-modal-overlay"

          role="presentation"

          onClick={closeAction}

        >

          <div

            className="modal unify-modal-card"

            role="dialog"

            aria-modal="true"

            aria-labelledby="modal-title"

            onClick={e => e.stopPropagation()}

          >

            <button
              type="button"
              className="modal-close unify-modal-close"

              onClick={closeAction}

              disabled={actionBusy}

              aria-label="Close"

            >

              <X size={22} />

            </button>

            <div className="modal-icon">

              {actionKind === "withdrawal" ? (

                <ArrowUpFromLine size={26} />

              ) : (

                <TrendingUp size={26} />

              )}

            </div>

            <h2 id="modal-title">

              {actionKind === "withdrawal"

                  ? "Withdrawal"

                  : "Start Investment"}

            </h2>

            {selectedProduct && (

              <p className="modal-description">

                {productDisplayName(selectedProduct.name)} ·{" "}

                {selectedProduct.illustrative_return_pct}%

                estimated return over{" "}

                {selectedProduct.duration_days} days

              </p>

            )}

            <div className="modal-balance">

              <span>{actionKind === "investment" ? "Available for test purchases" : "Available"}</span>
              <strong>{peso(actionKind === "investment" ? purchaseBalance : balance)}</strong>
              {actionKind === "investment" && <div className="purchase-balance-details">
                <div><span>Remaining Balance</span><b>{peso(remainingBalance)}</b></div>
                <div><span>Deposit Balance</span><b>{peso(balance)}</b></div>
                <small>Remaining Balance is used first.</small>
              </div>}

            </div>

            <label htmlFor="amount">

              Amount (PHP)

            </label>

            <input

              id="amount"

              type="number"

              min={

                selectedProduct

                  ? Number(selectedProduct.minimum_amount)

                  : 0.01

              }

              max="100000"

              step="0.01"

              value={actionAmount}

              onChange={e => setActionAmount(e.target.value)}

              placeholder="Enter amount"

              disabled={actionBusy}

            />

            {selectedProduct && (

              <p className="minimum">

                Minimum:{" "}

                {peso(Number(selectedProduct.minimum_amount))}

              </p>

            )}

            {message && <p className="unify-modal-feedback" role="alert">{message}</p>}

            <button
              type="button"
              className="confirm-button unify-modal-confirm"

              onClick={submitAction}

              disabled={actionBusy}

            >

              {actionBusy

                ? "Processing..."

                : actionKind === "withdrawal" ? "Confirm Withdrawal"
                : "Confirm Investment"}

              {!actionBusy && <CheckCircle2 size={19} />}

            </button>

            <button
              type="button"
              className="cancel-button unify-modal-cancel"

              onClick={closeAction}

              disabled={actionBusy}

            >

              Cancel

            </button>

          </div>

        </div>

      )}

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
        <p className="world-terms">{product.duration_days}-day plan · Entry price is not automatically returned. Funding verified at checkout.</p>
        <button type="button" className="invest-now-button" onClick={onInvest}>Start Investment <ChevronRight size={20} /></button>
      </div>
    </article>
  );
}
