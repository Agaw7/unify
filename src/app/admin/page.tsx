"use client";

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
} from "lucide-react";
import Link from "next/link";

type AdminStats = {
  currency: string;
  timezone: string;
  totalMembers: number;
  signupsToday: number;
  totalDeposits: number;
  depositsToday: number;
  verifiedDepositCount: number;
  pendingWithdrawals: number;
  totalWithdrawalsPaid: number | null;
  duplicateCreditEntries: number;
  paymongoBalance: number | null;
  depositDateBasis?: string;
};

const peso = (value: number) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(value);

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

      const response = await fetch("/api/admin/stats", {
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
      title: "PayMongo Test Balance",
      value: "Not available",
      icon: Wallet,
    },
    {
      title: "Today's Deposits",
      value: stats ? peso(stats.depositsToday) : "—",
      icon: ArrowDownToLine,
    },
    {
      title: "Total Deposits",
      value: stats ? peso(stats.totalDeposits) : "—",
      icon: History,
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
    {
      title: "Verified Deposit Count",
      value: stats ? stats.verifiedDepositCount.toLocaleString("en-PH") : "—",
      icon: History,
    },
    {
      title: "Pending Withdrawals",
      value:
        stats?.pendingWithdrawals != null
          ? peso(stats.pendingWithdrawals)
          : "—",
      icon: ArrowUpFromLine,
    },
    {
      title: "Simulated Paid Withdrawals",
      value:
        stats?.totalWithdrawalsPaid != null
          ? peso(stats.totalWithdrawalsPaid)
          : "Not verified",
      icon: Wallet,
    },
  ];

  return (
    <main className="admin-page">
      <header className="admin-header">
        <ShieldCheck size={30} />
        <div>
          <h1>UNIFY Admin</h1>
          <p>Management Dashboard</p>
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
        Today&apos;s Deposits use the Philippine date of the verified wallet
        credit. This is a <strong>sandbox ledger report</strong>, not a
        PayMongo merchant balance. Withdrawals in processing have <strong>not</strong>
        {" "}been paid to GCash/Maya. Paid totals require independently verified
        payout confirmations.
      </p>

      {stats && stats.duplicateCreditEntries > 0 && (
        <p role="alert" style={{ color: "#FFB86C" }}>
          Warning: duplicate deposit credit ledger entries detected. Review
          reconciliation before relying on totals.
        </p>
      )}

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
          Manage member accounts and review sandbox deposits, withdrawal
          requests, and transaction history.
        </p>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
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
            href="/admin/transactions"
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
            <History size={18} /> Manage Deposits &amp; Withdrawals
          </Link>
        </div>
      </section>

      <button className="admin-logout" onClick={() => void logout()}>
        <LogOut size={18} /> Logout
      </button>
    </main>
  );
}
