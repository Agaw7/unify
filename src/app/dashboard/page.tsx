"use client";


import { useCallback, useEffect, useState } from "react";

import {

  Home, Layers, Wallet, UserRound, Users,

  ArrowDownToLine, ArrowUpFromLine, TrendingUp,

  CalendarDays, ChevronRight, ShieldCheck,

  Copy, Check, LogOut, Trophy, History,

  UserPlus, RefreshCw, X, CheckCircle2,

  MessageCircle, Gift

} from "lucide-react";

import { supabase } from "@/lib/supabase";
import BankAccounts from "@/components/BankAccounts";
type Product = {

  id: string;

  name: string;

  description: string | null;

  minimum_amount: number;

  illustrative_return_pct: number;

  duration_days: number;

};

type Investment = {

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

};

type Member = {

  id: string;

  full_name: string | null;

  created_at: string;

};

type ActionKind = "deposit" | "withdrawal" | "investment";

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
    <section className="unify-payment-history">
      <div className="wallet-history-header">
        <div>
          <h4>Payment History</h4>
          <p>All your wallet and payment transactions</p>
        </div>
        <History size={20} />
      </div>
      {entries.length === 0 ? (
        <div className="wallet-empty-state">
          <div className="wallet-empty-icon"><History size={28} /></div>
          <strong>No transactions yet</strong>
          <p>Your activity will appear here.</p>
        </div>
      ) : (
        <div className="wallet-transaction-list">
          {entries.map((entry) => (
            <div className="wallet-transaction-row" key={entry.id}>
              <div className="wallet-transaction-info">
                <strong>{entry.label}</strong>
                <span>{new Date(entry.created_at).toLocaleString()} · {entry.status}</span>
              </div>
              <strong style={{ color: entry.isCredit ? "#10b981" : "#e2e8f0" }}>
                {entry.isCredit ? "+" : "−"}{peso(Math.abs(entry.amount))}
              </strong>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

type SimCredit = { investment_id: string; day_number: number };
const DAY_MS = 86400000;
type DailyTask = { threshold: number; reward: number; active_count: number; claimed: boolean };
const TASK_MILESTONES = [
  { threshold: 5, reward: 50 },
  { threshold: 10, reward: 100 },
  { threshold: 20, reward: 250 },
  { threshold: 30, reward: 400 },
  { threshold: 50, reward: 1500 },
];

export default function HomePage() {

  const [tab, setTab] = useState<Tab>("home");
  const [dailyTasks, setDailyTasks] = useState<DailyTask[]>([]);
  const [tasksBusy, setTasksBusy] = useState(false);
  const [tasksError, setTasksError] = useState("");
  const [tasksLoaded, setTasksLoaded] = useState(false);

  const [products, setProducts] = useState<Product[]>([]);

  const [investments, setInvestments] = useState<Investment[]>([]);
  const [claimedByInvestment,setClaimedByInvestment] = useState<Record<string,number>>({});
  const [claimBusy,setClaimBusy] = useState<string|null>(null);
  const [claimFeedback,setClaimFeedback] = useState("");
  const [clockNow,setClockNow] = useState(() => Date.now());
  useEffect(() => {const timer=window.setInterval(()=>setClockNow(Date.now()),1000);return ()=>window.clearInterval(timer);},[]);

  const [transactions, setTransactions] = useState<Transaction[]>([]);

  const [members, setMembers] = useState<Member[]>([]);
  const [selectedTeamLevel, setSelectedTeamLevel] = useState<1 | 2 | 3>(1);

  
  const [balance, setBalance] = useState(0);
  const [remainingBalance, setRemainingBalance] = useState(0);
  // Display the existing credited PayMongo Test Mode wallet.
  // This is a temporary read-only display mapping; do not credit funds here.
  const sandboxDepositBalance = balance;
  

  const [userId, setUserId] = useState<string | null>(null);

  const [email, setEmail] = useState("");

  const [verified, setVerified] = useState(false);

  const [profile, setProfile] = useState<Profile | null>(null);

  const [loading, setLoading] = useState(true);


  const [message, setMessage] = useState("");

  const [copied, setCopied] = useState(false);

  const [inviteLink, setInviteLink] = useState("");
  
useEffect(() => {
  if (!profile?.invite_code) {
    setInviteLink("");
    return;
  }

  const url = new URL("/register", window.location.origin);
  url.searchParams.set("ref", profile.invite_code);

  setInviteLink(url.toString());
}, [profile?.invite_code]);

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
      supabase.from("simulation_wallets").select("balance").eq("user_id",id).maybeSingle(),
      supabase.from("simulation_daily_credits").select("investment_id,day_number").eq("user_id",id)
    ]);
    if(wallet.error || credits.error){setClaimFeedback(wallet.error?.message ?? credits.error?.message ?? "Claims unavailable");return;}

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

  const [p, i, t, b, pr, m] = await Promise.all([

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

      supabase.from("team_members")

        .select("id, full_name, created_at")

        .eq("invited_by", id)

    ]);

    // Core wallet and investment queries must succeed.

const results = {

  products: p.error,

  investments: i.error,

  transactions: t.error,

  balance: b.error,

  profile: pr.error,

  members: m.error,

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

    description: "UniFi hardware plan",

    minimum_amount: Number(item.price),

    illustrative_return_pct:

      Number(item.price) > 0

        ? (Number(item.daily_income) / Number(item.price)) * 100

        : 0,

    duration_days: 365,

  })) as Product[]);

  // The purchase RPC writes to demo_investments, not investments.
  // demo_investments has no status column, so use a display-only label.
  if (i.error) {
    setMessage(`Unable to load your portfolio: ${i.error.message}`);
  } else {
    setInvestments((i.data ?? []).map((row) => ({
      id: String(row.id),
      product_id: String(row.product_id),
      amount: Number(row.amount),
      daily_income: Number(row.daily_income ?? 0),
      created_at: String(row.created_at),
      status: "Simulated purchase",
    })));
  }

  setTransactions((t.data ?? []) as Transaction[]);
  
if (b.error) {
    console.error("UNIFY balance error:", {
      message: b.error.message,
      code: b.error.code,
      details: b.error.details,
      hint: b.error.hint,
    });
    setMessage("Unable to load your wallet balance. Please refresh.");
  } else if (b.data) {
    setBalance(Number(b.data.balance));
  } else {
    console.warn("UNIFY wallet account not found for user:", id);
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
      console.log("UNIFY test balance loaded:", amount);
    }
  }

  if (pr.error) {
    console.error("UNIFY profile error:", pr.error);
    setMessage(`Profile loading failed: ${pr.error.message}`);
  } else if (!pr.data) {
    setProfile(null);
    setMessage("Member profile not found.");
  } else {
    const memberProfile = pr.data as Profile;
    setProfile(memberProfile);
    console.log("UNIFY profile loaded:", {
      hasInviteCode: Boolean(memberProfile.invite_code),
    });
  }

  setMembers((m.data ?? []) as Member[]);

  }, []);

  useEffect(() => {

    async function initialize() {

      try {

        const { data, error } = await supabase.auth.getUser();

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

  const loadDailyTasks = useCallback(async () => {
    setTasksBusy(true);
    setTasksError("");
    const { data, error } = await supabase.rpc("get_daily_team_tasks");
    if (error) {
      setTasksError(error.message);
      setTasksLoaded(false);
    } else {
      setDailyTasks((data ?? []) as DailyTask[]);
      setTasksLoaded(true);
    }
    setTasksBusy(false);
  }, []);

  useEffect(() => {
    if (tab === "tasks" && userId) void loadDailyTasks();
  }, [tab, userId, loadDailyTasks]);

  async function claimDailyTask(threshold: number) {
    if (tasksBusy) return;
    setTasksBusy(true);
    setTasksError("");
    const { error } = await supabase.rpc("claim_daily_team_task", {
      p_threshold: threshold,
    });
    if (error) {
      setTasksError(error.message);
      setTasksBusy(false);
      return;
    }
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

  function openAction(

    kind: ActionKind,

    product?: Product

  ) {

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

      amount > balance

    ) {

      setMessage("Insufficient balance.");

      return;

    }

    // Never credit or debit real-money wallets through the legacy my_action RPC.
    if (actionKind === "deposit") {
      setActionKind(null);
      window.location.assign("/deposit");
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

        const { data, error } = await supabase.rpc(
          "purchase_demo_investment",
          {
            p_product_id: selectedProduct.id,
            p_amount: amount,
          }
        );

        if (error) {
          console.error("Investment purchase error:", error);
          throw new Error(error.message);
        }

        console.log("Sandbox investment created:", data);
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

    window.location.reload();
  }
  
  
    const getProduct = (id: string) =>

    products.find(p => String(p.id) === String(id));

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

        Loading UNIFY...

      </main>

    );

  }

  if (!userId) {

    return (

      <main className="loading">

        <h1>UNIFY</h1>

        <p>{message || "Please sign in."}</p>

        <a href="/login">Go to Login</a>

      </main>

    );

  }

  return (

    <div className="vault-app">

      <header className="vault-header">

        <div className="brand">

          <div className="brand-logo">◆</div>

          <div>

            <h1>UNIFY</h1>
          </div>

        </div>

        <div className="label">

          <ShieldCheck size={15} />

        </div>

      </header>

      <main className="vault-main">

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

          <>

            <div className="welcome">

              <span>WELCOME TO UNIFY</span>

              <h2>Grow your knowledge.</h2>

              <p>

                Explore investments.
              </p>

            </div>

<div className="wallet-account-card">
  <div className="unify-wallet-summary">
    <div className="unify-balance-card">
      <span>Remaining Balance · Test Mode</span>
      <h2>{peso(remainingBalance)}</h2>
      <p>Includes the one-time ₱30 registration bonus · Simulated withdrawals only</p>
    </div>
    <div className="unify-balance-card">
      <span>Deposit Balance · Test Mode</span>
      <h2>{peso(sandboxDepositBalance)}</h2>
    
      <p>Sandbox test deposits · Not withdrawable</p>
    </div>
  </div>

  <PaymentHistory entries={allPaymentHistory} />
</div>

              <section className="quick-section">

              <h3>Quick Actions</h3>

<div className="quick-grid unify-action-grid">

  <button

    type="button"

    className="unify-action-card"
    onClick={() => openAction("deposit")}

  >

    <ArrowDownToLine size={24} />

    <span>Deposit</span>

  </button>

  <button

    type="button"

    className="unify-action-card"
    onClick={() => window.location.assign("/withdraw")}

  >

    <ArrowUpFromLine size={24} />

    <span>Withdraw</span>

  </button>

  <button

    type="button"

    onClick={() => {

      window.open(

        "https\://t.me/+q6uAIuQt50VlMjBl",

        "_blank",

        "noopener,noreferrer"

      );

    }}

  >

    <MessageCircle size={24} />

    <span>Support</span>

  </button>

  <button

    type="button"

    onClick={() => setTab("assets")}

  >

    <Layers size={24} />

    <span>My Portfolio</span>

  </button>

</div>

            </section>

            <div className="section-heading">

              <h3>Featured Products</h3>

              <button onClick={() => setTab("products")}>

                View All <ChevronRight size={17} />

              </button>

            </div>

            <div className="product-grid">

              {products.slice(0, 8).map(product => (

                <ProductCard

                  key={product.id}

                  product={product}

                  onInvest={() => openAction("investment", product)}

                />

              ))}

            </div>

          </>

        )}

{/* DAILY TASKS */}
{tab === "tasks" && (
  <section className="unify-daily-tasks">
    <div className="page-heading">
      <h2>Daily Tasks</h2>
      <p>Active Team Missions · Resets daily at 12:00 AM Philippine time.</p>
    </div>
    <div className="unify-task-info">
      <Users size={22} />
      <div>
        <strong>{dailyTasks[0]?.active_count ?? 0} active invited members today</strong>
        <p>An invited member counts once today after starting a qualifying product investment today. Each unlocked milestone must be claimed separately.</p>
      </div>
    </div>
    
    {tasksError && <div className="notice" role="alert">{tasksError}. Run the accompanying SQL setup in Supabase if tasks are not configured.</div>}
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
              <strong>{threshold} active members</strong>
              <span>{unlocked ? "Milestone unlocked" : `${Math.max(0, threshold - count)} more to unlock`}</span>
              <div className="unify-task-progress"><div style={{width: `${Math.min(100, count / threshold * 100)}%`}} /></div>
            </div>
            <div className="unify-task-reward">
              <strong>{peso(reward)}</strong>
              <button
                type="button"
                disabled={!tasksLoaded || tasksBusy || !unlocked || claimed}
                onClick={() => claimDailyTask(threshold)}
              >
                {claimed ? "Claimed" : unlocked ? "Claim" : "Locked"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
    <button className="unify-task-refresh" type="button" disabled={tasksBusy} onClick={loadDailyTasks}>
      <RefreshCw size={16} /> {tasksBusy ? "Loading..." : "Refresh today's tasks"}
    </button>
    <button type="button" className="invest-now-button" onClick={() => setTab("profile")}>Back to Profile</button>
   
  </section>
)}

{/* BANK ACCOUNT */}
{tab === "bank" && <BankAccounts onBack={() => setTab("profile")} />}

        {/* PRODUCTS */}

        {tab === "products" && (

          <>

            <div className="page-heading">

              <h2>Investment Products</h2>

            </div>

            <div className="product-grid">

              {products.map(product => (

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

        {tab === "assets" && (

          <>

            <div className="page-heading">

              <h2>My Portfolio</h2>

              <p>Track your investments.</p>

            </div>

            <div className="portfolio-summary">

              <span>ILLUSTRATIVE DAILY AMOUNT</span>

              <h2>{peso(projected)}</h2>

              <small>Simulation only — not earned or withdrawable funds.</small>

                <small>Separate sandbox wallet · cannot be withdrawn or used for purchases.</small></div>
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

                            src={productImages[productName]}

                            alt={productName}

                            className="product-image"

                          />

                        ) : (

                          <TrendingUp size={25} />

                        )}

                      </div>

                      <div>

                        <h3>

                          {productName}

                        </h3>

                        <strong>

                          {peso(Number(inv.amount))}

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

              <h2>My Team</h2>
            </div>

            <section className="team-panel">

              <h3>Invite Link</h3>

              <div className="invite-link">

                {inviteLink || "No invitation code available"}

              </div>

              <button

                className="invite-button"

                onClick={copyInvite}

                disabled={!inviteLink}

              >

                {copied ? <Check size={20} /> : <Copy size={20} />}

                {copied ? "Copied!" : "Copy Link"}

              </button>

            </section>

            <section className="team-stats-card unify-team-stats">
              <div className="team-gradient">
                <Users size={27} />
                <span>MY TEAM</span>
                <h2>{members.length} Direct Members</h2>
                <p>Referral</p>
              </div>

              <div className="team-stat-grid">
                <div><strong>₱0.00</strong><span>COMMISSIONS</span></div>
                <div><strong>{members.length}</strong><span>DIRECT MEMBERS</span></div>
                <div><strong>0</strong><span>VERIFIED INDIRECT MEMBERS</span></div>
              </div>
            </section>

            <section className="team-members unify-level-members">
              <div className="section-heading">
                <h3>Members</h3>
                <span>rates</span>
              </div>
              <div className="unify-level-tabs" role="group" aria-label="Referral level">
                {([1, 2, 3] as const).map((level) => (
                  <button
                    key={level}
                    type="button"
                    className={selectedTeamLevel === level ? "active" : ""}
                    aria-pressed={selectedTeamLevel === level}
                    onClick={() => setSelectedTeamLevel(level)}
                  >
                    L{level} · {level === 1 ? 30 : level === 2 ? 2 : 1}%
                  </button>
                ))}
              </div>
              <div className="unify-level-meta">
                <span>{selectedTeamLevel === 1 ? members.length : 0} users</span>
                <span>₱0.00 rewards</span>
              </div>
              {selectedTeamLevel !== 1 ? (
                <div className="team-empty">
                  <UserPlus size={32} />
                  <h3>No verified Level {selectedTeamLevel} members</h3>
                  <p>Indirect referrals need additional relationship data in Supabase.</p>
                </div>
              ) : members.length === 0 ? (
                <div className="team-empty">
                  <UserPlus size={36} />
                  <h3>No direct members yet</h3>
                 
                </div>
              ) : (
                members.map((member) => (
                  <div className="member-row" key={member.id}>
                    <div className="member-avatar"><Users size={19} /></div>
                    <div>
                      <strong>{member.full_name || "Member"}</strong>
                      <span>Joined {new Date(member.created_at).toLocaleDateString()}</span>
                    </div>
                    <span className="member-status">L1</span>
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

            <div className="unify-wallet-summary">
    <div className="unify-balance-card">
      <span>Remaining Balance · Test Mode</span>
      <h2>{peso(remainingBalance)}</h2>
      <p>Includes the one-time ₱30 registration bonus · Simulated withdrawals only</p>
    </div>
    <div className="unify-balance-card">
      <span>Deposit Balance · Test Mode</span>
      <h2>{peso(sandboxDepositBalance)}</h2>
      
      <p>Sandbox test deposits · Not withdrawable</p>
    </div>
  </div>

              <PaymentHistory entries={allPaymentHistory} />

          </>

        )}

        {/* PROFILE */}

        {tab === "profile" && (

          <div className="profile-page">

            <div className="page-heading">

              <h2>My Profile</h2>

              <p>Manage your UNIFY account.</p>

            </div>

            <div className="profile-banner">

              <div className="profile-avatar">

                <UserRound size={36} />

              </div>

              <div className="profile-details">

                <span>ACCOUNT</span>

                <h3>

                  {profile?.full_name || "UNIFY Member"}

                </h3>

                <p>{email}</p>

                <div className="verification-status">

                  <ShieldCheck size={15} />

                  {verified

                    ? "Account Verified"

                    : "Account Not Verified"}

                </div>

              </div>

            </div>

            <div className="profile-menu">

{[

  {
  label: "Daily Tasks",
  icon: Trophy,
  page: "tasks"
},

  {

    label: "Bank Account",

    icon: Wallet,

    page: "bank"

  },

  {

    label: "Deposit",

    icon: ArrowDownToLine,

    page: "wallet"

  },

  {

    label: "Withdraw",

    icon: ArrowUpFromLine,

    page: "wallet"

  }

].map(item => {

  const Icon = item.icon;

  return (

    <button

      className="profile-menu-item"

      key={item.label}

      onClick={() => {

        if (item.label === "Deposit") {

          openAction("deposit");

        } else if (item.label === "Withdraw") {

          window.location.assign("/withdraw");

        } else if (item.page === "tasks") {

          setTab("tasks");

        } else if (item.page === "bank") {

          setTab("bank");

        } else {

          setTab("wallet");

        }

      }}

    >

      <Icon size={21} />

      <span>{item.label}</span>

      <ChevronRight size={20} />

    </button>

  );

})}

              <button

                className="profile-menu-item logout-item"

                onClick={logout}

              >

                <LogOut size={21} />

                <span>Logout</span>

                <ChevronRight size={20} />

              </button>

            </div>

          </div>

        )}

      </main>
    
      {/*  TRANSACTION  */}

      {actionKind && (

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

              {actionKind === "deposit" ? (

                <ArrowDownToLine size={26} />

              ) : actionKind === "withdrawal" ? (

                <ArrowUpFromLine size={26} />

              ) : (

                <TrendingUp size={26} />

              )}

            </div>

            <h2 id="modal-title">

              {actionKind === "deposit"

                ? "Deposit"

                : actionKind === "withdrawal"

                  ? "Withdrawal"

                  : "Start Investment"}

            </h2>

            {selectedProduct && (

              <p className="modal-description">

                {selectedProduct.name} ·{" "}

                {selectedProduct.illustrative_return_pct}%

                estimated return over{" "}

                {selectedProduct.duration_days} days

              </p>

            )}

            <div className="modal-balance">

              Available: <strong>{peso(balance)}</strong>

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

                : actionKind === "deposit" ? "Confirm Deposit"
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

<nav className="bottom-nav">

  {[

    { id: "home" as Tab, icon: Home, label: "Home" },

    { id: "assets" as Tab, icon: Layers, label: "Assets" },

    { id: "team" as Tab, icon: Users, label: "Team" },

    { id: "profile" as Tab, icon: UserRound, label: "Me" }

  ].map(item => {

    const Icon = item.icon;

    return (

      <button

        key={item.id}

        className={tab === item.id ? "active" : ""}

        onClick={() => setTab(item.id)}

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

function ProductCard({

  product,

  onInvest

}: {

  product: Product;

  onInvest: () => void;

}) {

  const amount = Number(product.minimum_amount);

  const rate = Number(product.illustrative_return_pct);

  const earnings = amount * rate / 100;

  return (

    <div className="investment-card">

      <div className="card-top">

            <div className="product-image-box">

               <img

               src={productImages[product.name] || "/products/g5-flex.png"}

               alt={product.name}

             className="product-image"

            onError={(e) => {

           console.error("Image failed to load:", e.currentTarget.src);

         }}

          />

        </div>

        <div>

          <h3>{product.name}</h3>

          <strong>{peso(amount)}</strong>

        </div>

        <span className="duration-badge">

          {product.duration_days} days

        </span>

      </div>

      <p className="product-description">

        {product.description}

      </p>

     <div className="product-stats">

       <div>

       <span>Projected Daily Earnings</span>

          <strong className="green">

            {peso(earnings)}

        </strong>

       </div>

      </div>

      <div className="product-footer">

        <div>

          <CalendarDays size={15} />

          <span>

            {product.duration_days} days

          </span>

        </div>

        <span>

          Illustrative daily amount: {peso(earnings)}

        </span>

      </div>

      <button

        type="button"

        className="invest-now-button"

        onClick={onInvest}

      >

        Start Investment

        <ChevronRight size={20} />

      </button>

    </div>

  );

}
