
"use client";
import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Transaction = {
  id: string;
  user_id: string;
  transaction_type: string;
  amount: number;
  currency: string;
  status: string;
  provider?: string | null;
  provider_reference?: string | null;
  created_at: string;
  member_phone?: string;
};

type Withdrawal = {
  id: string;
  user_id: string;
  member_phone?: string | null;
  amount: number;
  status: string;
  payment_method: string;
  created_at: string;
};

export default function AdminTransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
     
const {
  data: { session },
  error: sessionError,
} = await supabase.auth.getSession();

if (sessionError || !session?.access_token) {
  throw new Error("Please log in as an administrator.");
}

const response = await fetch("/api/admin/overview", {
  headers: {
    Authorization: `Bearer ${session.access_token}`,
  },
  cache: "no-store",
});


      const result = await response.json();

if (!response.ok) {
  throw new Error(
    [result.error, result.details, result.code]
      .filter(Boolean)
      .join(" | ") || "Withdrawal approval failed."
  );
}
      setTransactions(result.transactions ?? []);
      setWithdrawals(result.withdrawals ?? []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to load transactions"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);


async function approveDeposit(id: string) {
  if (!window.confirm("Verify this PayMongo sandbox deposit?")) {
    return;
  }

  setBusyId(id);
  setError("");
  setMessage("");

  try {
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session?.access_token) {
      throw new Error("Please log in as an administrator.");
    }

    const response = await fetch(
      `/api/admin/deposit/${encodeURIComponent(id)}/verify`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      }
    );

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Deposit verification failed.");
    }

    setMessage("Verified sandbox deposit processed.");
    await loadData();
  } catch (err) {
    setError(
      err instanceof Error ? err.message : "Deposit verification failed."
    );
  } finally {
    setBusyId(null);
  }
}



async function approveWithdrawal(id: string) {
  if (!window.confirm("Approve withdrawal for processing?")) {
    return;
  }

  setBusyId(id);
  setError("");
  setMessage("");

  try {
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session?.access_token) {
      throw new Error("Please log in as an administrator.");
    }

    const response = await fetch(
      `/api/admin/withdraw/${encodeURIComponent(id)}/approve`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      }
    );

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Withdrawal approval failed.");
    }

    setMessage("Withdrawal approved for processing.");
    await loadData();
  } catch (err) {
    setError(
      err instanceof Error ? err.message : "Withdrawal approval failed."
    );
  } finally {
    setBusyId(null);
  }
}


  async function simulateCompleteWithdrawal(id: string) {
    if (!window.confirm(
      "SIMULATION ONLY: Mark this withdrawal as simulated paid? No GCash/Maya money will be sent."
    )) return;
    setBusyId(id);
    setError("");
    setMessage("");
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session?.access_token) throw new Error("Please log in again.");
      const response = await fetch(
        `/api/admin/withdraw/${encodeURIComponent(id)}/simulate-complete`,
        { method: "POST", headers: { Authorization: `Bearer ${session.access_token}` } }
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Simulation failed.");
      setMessage(result.message || "Simulated payout completed; no real money sent.");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Simulation failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleCancelDeposit(id: string) {
    if (
      !window.confirm(
        "Expire this PayMongo sandbox checkout and cancel the pending deposit?"
      )
    ) {
      return;
    }

    setBusyId(id);
    setError("");
    setMessage("");

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session?.access_token) {
        throw new Error("Please log in as an administrator.");
      }

      const response = await fetch(
        `/api/admin/deposit/${encodeURIComponent(id)}/delete`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Unable to cancel deposit.");
      }

      setMessage("Sandbox deposit cancelled successfully.");
      await loadData();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to cancel deposit."
      );
    } finally {
      setBusyId(null);
    }
  }

  const money = (amount: number) =>
    new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
    }).format(amount);

  const panelStyle: React.CSSProperties = {
    background: "#14243B",
    border: "1px solid #29425E",
    borderRadius: 14,
    padding: 20,
    marginBottom: 24,
    overflowX: "auto",
  };

  const tableStyle: React.CSSProperties = {
    width: "100%",
    borderCollapse: "collapse",
    minWidth: 750,
    textAlign: "left",
  };

  const cellStyle: React.CSSProperties = {
    padding: "12px 10px",
    borderBottom: "1px solid #29425E",
  };

  const buttonStyle: React.CSSProperties = {
    padding: "9px 14px",
    background: "#00BDF2",
    color: "#06111F",
    border: "none",
    borderRadius: 8,
    fontWeight: 700,
    cursor: "pointer",
  };

  return (
    <main
      style={{
        background: "#0B1320",
        color: "white",
        minHeight: "100vh",
        padding: 24,
      }}
    >
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>
        UNIFY Admin Transactions
      </h1>

      <p style={{ color: "#9BAFC7", marginBottom: 24 }}>
        Review sandbox deposits, withdrawals, and payment history.
      </p>

      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
          marginBottom: 20,
        }}
      >
        <Link
          href="/admin"
          style={{
            ...buttonStyle,
            background: "#243B58",
            color: "#FFFFFF",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            textDecoration: "none",
          }}
        >
          ← Back to Admin
        </Link>

        <button
          type="button"
          onClick={() => void loadData()}
          disabled={loading}
          style={{ ...buttonStyle, opacity: loading ? 0.6 : 1 }}
        >
          {loading ? "Loading..." : "Refresh Transactions"}
        </button>
      </div>

      {error && (
        <p style={{ color: "#FF8F8F", marginBottom: 16 }}>
          {error}
        </p>
      )}

      {message && (
        <p style={{ color: "#69E3A1", marginBottom: 16 }}>
          {message}
        </p>
      )}

      <section style={panelStyle}>
        <h2 style={{ marginBottom: 16 }}>Deposits</h2>

        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={cellStyle}>Transaction</th>
              <th style={cellStyle}>Member</th>
              <th style={cellStyle}>Amount</th>
              <th style={cellStyle}>Status</th>
              <th style={cellStyle}>Date</th>
              <th style={cellStyle}>Action</th>
            </tr>
          </thead>

          <tbody>
            {transactions
              .filter(
  (tx) =>
    tx.transaction_type === "deposit" &&
    tx.status !== "cancelled"
)
              .map((tx) => (
                <tr key={tx.id}>
                  <td style={cellStyle}>{tx.id.slice(0, 8)}...</td>
                  <td>{tx.member_phone ?? "No phone registered"}</td>
                  <td style={cellStyle}>{money(Number(tx.amount))}</td>
                  <td style={cellStyle}>{tx.status}</td>
                  <td style={cellStyle}>
                    {new Date(tx.created_at).toLocaleString()}
                  </td>
                  <td style={cellStyle}>
                    {tx.status === "pending" ? (
                      <div
                        style={{
                          display: "flex",
                          gap: 10,
                          flexWrap: "wrap",
                          alignItems: "center",
                        }}
                      >
                        <button
                          type="button"
                          style={{
                            ...buttonStyle,
                            opacity: busyId !== null ? 0.6 : 1,
                          }}
                          disabled={busyId !== null}
                          onClick={() => void approveDeposit(tx.id)}
                        >
                          {busyId === tx.id
                            ? "Processing..."
                            : "Verify & Approve"}
                        </button>
                        <button
                          type="button"
                          style={{
                            ...buttonStyle,
                            background: "#EF4444",
                            color: "#FFFFFF",
                            opacity: busyId !== null ? 0.6 : 1,
                          }}
                          disabled={busyId !== null}
                          onClick={() => void handleCancelDeposit(tx.id)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>
                  
                </tr>
              ))}
          </tbody>
        </table>
      </section>

      <section style={panelStyle}>
        <h2 style={{ marginBottom: 16 }}>Withdrawals</h2>

        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={cellStyle}>Request</th>
              <th style={cellStyle}>Member</th>
              <th style={cellStyle}>Amount</th>
              <th style={cellStyle}>Method</th>
              <th style={cellStyle}>Status</th>
              <th style={cellStyle}>Action</th>
            </tr>
          </thead>

          <tbody>
            {withdrawals.map((withdrawal) => (
              <tr key={withdrawal.id}>
                <td style={cellStyle}>
                  {withdrawal.id.slice(0, 8)}...
                </td>
                <td style={cellStyle}>
                  {withdrawal.member_phone ?? "No phone registered"}</td>
                <td style={cellStyle}>
                  {money(Number(withdrawal.amount))}
                </td>
                <td style={cellStyle}>
                  {withdrawal.payment_method}
                </td>
                <td style={cellStyle}>
                  {withdrawal.status}
                </td>
                <td style={cellStyle}>
                  {withdrawal.status === "reserved" ? (
                    <button
                      style={buttonStyle}
                      disabled={busyId !== null}
                      onClick={() =>
                        void approveWithdrawal(withdrawal.id)
                      }
                    >
                      {busyId === withdrawal.id
                        ? "Processing..."
                        : "Approve Withdrawal"}
                    </button>
                  ) : withdrawal.status === "processing" ? (
                    <button
                      type="button"
                      style={{ ...buttonStyle, background: "#22C55E", color: "#071B13" }}
                      disabled={busyId !== null}
                      onClick={() => void simulateCompleteWithdrawal(withdrawal.id)}
                    >
                      {busyId === withdrawal.id ? "Processing..." : "Mark Simulated Paid"}
                    </button>
                  ) : withdrawal.status === "completed" ? (
                    <span>Simulated paid (check payout record)</span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={panelStyle}>
        <h2 style={{ marginBottom: 16 }}>All Transactions</h2>

        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={cellStyle}>Type</th>
              <th style={cellStyle}>Amount</th>
              <th style={cellStyle}>Provider</th>
              <th style={cellStyle}>Status</th>
              <th style={cellStyle}>Created</th>
            </tr>
          </thead>

          <tbody>
            {transactions.map((tx) => (
              <tr key={tx.id}>
                <td style={cellStyle}>{tx.transaction_type}</td>
                <td style={cellStyle}>{money(Number(tx.amount))}</td>
                <td style={cellStyle}>{tx.provider ?? "—"}</td>
                <td style={cellStyle}>{tx.status}</td>
                <td style={cellStyle}>
                  {new Date(tx.created_at).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
