"use client";

import { formatPhp } from '@/lib/format-php';
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  ShieldCheck,
  Users,
  Wallet,
  History,
  LogOut,
  UserPlus,
  ArrowDownToLine,
  ArrowUpFromLine,
  RefreshCw,
  Gift,
} from "lucide-react";
import Link from "next/link";

type AdminStats = {
  treasury?:{ready:boolean;cash:number;shortfall:number}|null;
  businessBudget:{overall:number;available:number;reserved:number;sales:number;funded:number};
  currency: string;
  timezone: string;
  totalMembers: number;
  signupsToday: number;
  totalDeposits: number;
  depositsToday: number;
  verifiedDepositCount: number;
  pendingWithdrawals: number;
  totalWithdrawalsPaid: number | null;
  withdrawalsPaidToday: number;
  duplicateCreditEntries?: number;
  manualPayments?: boolean;
  depositDateBasis?: string;
};

const peso = (value: number) =>
  formatPhp(value);

export default function AdminPage() {
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState("");
  const [adminPhone, setAdminPhone] = useState("");

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    setStatsError("");
    try {
      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (sessionError || !token) throw new Error("Please log in again.");

      const response = await fetch("/api/admin/live-dashboard", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const result: AdminStats & { error?: string } = await response.json();
      if (!response.ok) {
        throw new Error(result.error ?? "Unable to load statistics.");
      }
      setStats(result);
    } catch (error) {
      setStatsError(
        error instanceof Error ? error.message : "Unable to load statistics."
      );
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function checkAdmin() {
      try {
        const { data: authData, error: authError } =
          await supabase.auth.getUser();
        if (authError || !authData.user) return;

        const { data, error } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", authData.user.id)
          .maybeSingle();

        if (active && !error && data?.role === "admin") {
          setAuthorized(true);
          setAdminPhone(authData.user.phone ?? "");
          void loadStats();
        }
      } catch {
        // Deny access when the role cannot be verified.
      } finally {
        if (active) setLoading(false);
      }
    }

    void checkAdmin();
    return () => {
      active = false;
    };
  }, [loadStats]);

  useEffect(() => {
    if (!authorized) return;
    const refreshVisible = () => { if (!document.hidden) void loadStats(); };
    const timer = window.setInterval(refreshVisible, 30000);
    window.addEventListener('focus', refreshVisible);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refreshVisible); };
  }, [authorized, loadStats]);

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  if (loading) {
    return <main className="admin-page">Checking admin access...</main>;
  }

  if (!authorized) {
    return (
      <main className="admin-page">
        <h1>Access Denied</h1>
        <p>Administrator account required.</p>
        <Link href="/login">Go to Login</Link>
      </main>
    );
  }

  const metrics = [
    {
      title: "Today's Deposits",
      value: stats ? peso(stats.depositsToday) : "—",
      icon: ArrowDownToLine,
    },
    {
      title: "Today's Paid Withdrawals",
      value: stats ? peso(stats.withdrawalsPaidToday) : "—",
      icon: ArrowUpFromLine,
    },
    {
      title: "Total Deposits",
      value: stats ? peso(stats.totalDeposits) : "—",
      icon: History,
    },
    {
      title: "Paid Withdrawals",
      value:
        stats?.totalWithdrawalsPaid != null
          ? peso(stats.totalWithdrawalsPaid)
          : "Not verified",
      icon: Wallet,
    },
    {
      title: "Total Members",
      value: stats ? stats.totalMembers.toLocaleString("en-PH") : "—",
      icon: Users,
    },
    {
      title: "Today's Signups",
      value: stats ? stats.signupsToday.toLocaleString("en-PH") : "—",
      icon: UserPlus,
    },
  ];

  return (
    <main className="admin-page">
      <header className="admin-header">
        <ShieldCheck size={30} />
        <div>
          <h1>AUREVIA Admin</h1>
          <p>Management Dashboard</p>
          <Link href="/admin/money" style={{ color: '#93c5fd' }}>PHP payment operations</Link>
          {adminPhone && (
            <p style={{ fontSize: 12, color: "#9BB5D1" }}>
              Signed in as {adminPhone}
            </p>
          )}
        </div>
      </header>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 18,
        }}
      >
        <p style={{ color: "#9BB5D1", margin: 0 }}>
          Platform statistics · Philippine time (UTC+8)
        </p>
        <button
          type="button"
          onClick={() => void loadStats()}
          disabled={statsLoading}
          style={{
            background: "#00C8F8",
            color: "#061526",
            border: 0,
            borderRadius: 10,
            padding: "11px 16px",
            fontWeight: 700,
            cursor: statsLoading ? "wait" : "pointer",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <RefreshCw size={16} />
          {statsLoading ? "Refreshing..." : "Refresh Statistics"}
        </button>
      </div>

      {statsError && (
        <p role="alert" style={{ color: "#FF9999", marginBottom: 16 }}>
          {statsError}
        </p>
      )}

      <section className="admin-stat admin-wallet-highlight" aria-label="Business balance and rewards budget">
        <Wallet size={34} />
        <span>Overall cash balance</span>
        <p>{stats?.treasury?'PalawanPay deposits · GoTyme withdrawals':'Recorded business funds'}</p>
        <h2>{stats?.treasury?(stats.treasury.ready?peso(Number(stats.treasury.cash)/100):'Confirm opening balances'):stats?.businessBudget?peso(stats.businessBudget.overall):statsLoading?'Loading...':'Unavailable'}</h2>
        {stats?.treasury&&<Link className="admin-budget-link" href="/admin/treasury">{stats.treasury.ready?'Reconcile cash accounts →':'Set up cash tracking →'}</Link>}
      </section>

      <div className="admin-grid">
        {metrics.map(({ title, value, icon: Icon }) => (
          <div className="admin-stat" key={title}>
            <Icon />
            <span>{title}</span>
            <h2
              style={{
                fontSize: value.length > 12 ? "1.3rem" : undefined,
                overflowWrap: "anywhere",
              }}
            >
              {statsLoading && !stats ? "Loading..." : value}
            </h2>
          </div>
        ))}
      </div>

      <p style={{ color: "#9BB5D1", fontSize: 13, marginTop: 12 }}>
        Live deposits and payouts only · Today&apos;s deposits use the Philippine date of verified payment credit.
        {' External account balances are not available in this dashboard; check official account statements.'}
      </p>

      <section
        style={{
          background: "#10243B",
          padding: 24,
          borderRadius: 18,
          marginTop: 24,
        }}
      >
        <h2 style={{ color: "white", marginBottom: 10 }}>
          Administration
        </h2>
        <p style={{ color: "#9BB5D1", marginBottom: 24 }}>
          Manage member accounts and review live deposits, withdrawal
          requests, and transaction history.
        </p>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <Link href="/admin/free-plans" style={{ display: "inline-flex", alignItems: "center", gap: 10, background: "#00C8F8", color: "#061526", padding: "14px 20px", borderRadius: 12, fontWeight: 700 }}><Gift size={20} />Free Plan</Link>
          <Link
            href="/admin/users"
            style={{
              background: "#00C8F8",
              color: "#061526",
              padding: "14px 20px",
              borderRadius: 10,
              fontWeight: 700,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Users size={18} /> User Management
          </Link>
          <Link
            href="/admin/deposits"
            style={{
              background: "#193B5B",
              color: "#FFFFFF",
              padding: "14px 20px",
              borderRadius: 10,
              fontWeight: 700,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <ArrowDownToLine size={18} /> Test Deposits
          </Link>
          <Link
            href="/admin/withdrawals"
            style={{
              background: "#193B5B",
              color: "#FFFFFF",
              padding: "14px 20px",
              borderRadius: 10,
              fontWeight: 700,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <ArrowUpFromLine size={18} /> Manage Withdrawals
          </Link>
          <Link
            href="/admin/deposits/approved"
            style={{
              background: "#193B5B",
              color: "#FFFFFF",
              padding: "14px 20px",
              borderRadius: 10,
              fontWeight: 700,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <ArrowDownToLine size={18} /> Confirmed Test Deposits
          </Link>
          <Link
            href="/admin/withdrawals/approved"
            style={{
              background: "#193B5B",
              color: "#FFFFFF",
              padding: "14px 20px",
              borderRadius: 10,
              fontWeight: 700,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <ArrowUpFromLine size={18} /> Approved Withdrawals
          </Link>
        </div>
      </section>


      <button className="admin-logout" onClick={() => void logout()}>
        <LogOut size={18} /> Logout
      </button>
    </main>
  );
}
