
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Transaction = {
  id: string;
  transaction_type: "deposit" | "withdraw";
  amount_centavos: number;
  balance_after_centavos: number;
  created_at: string;
};

const peso = (centavos: number) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(centavos / 100);

export default function SafeWalletPage() {
  const router = useRouter();
  const [balance, setBalance] = useState(0);
  const [amount, setAmount] = useState("");
  const [history, setHistory] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState("");

  const loadWallet = useCallback(async () => {
    const { data: userData, error: userError } =
      await supabase.auth.getUser();

    if (userError || !userData.user) {
      router.replace("/login");
      return;
    }

    const userId = userData.user.id;

    const [walletResult, transactionsResult] = await Promise.all([
      supabase
        .from("unify_sandbox_wallets")
        .select("balance_centavos")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("unify_sandbox_transactions")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    if (walletResult.error || transactionsResult.error) {
      setMessage(
        walletResult.error?.message ||
        transactionsResult.error?.message ||
        "Unable to load wallet."
      );
    } else {
      setBalance(walletResult.data?.balance_centavos ?? 0);
      setHistory(transactionsResult.data ?? []);
    }

    setLoading(false);
  }, [router]);

  useEffect(() => {
    void loadWallet();
  }, [loadWallet]);

  async function transfer(type: "deposit" | "withdraw") {
    if (processing) return;

    setProcessing(true);
    setMessage("");

    try {
      const { data: sessionData } =
        await supabase.auth.getSession();

      const token = sessionData.session?.access_token;

      if (!token) {
        router.replace("/login");
        return;
      }

      const response = await fetch("/payments/deposits", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ amount: amount.trim() }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Transaction failed.");
      }

      setAmount("");
      setMessage(
        type === "deposit"
          ? "deposit completed."
          : "withdrawal completed."
      );

      await loadWallet();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unexpected error."
      );
    } finally {
      setProcessing(false);
    }
  }

  const card: React.CSSProperties = {
    background: "#142238",
    borderRadius: 14,
    padding: 24,
    marginTop: 20,
  };

  const button: React.CSSProperties = {
    flex: 1,
    padding: 13,
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    fontWeight: 700,
  };

  return (
    <main style={{
      minHeight: "100vh",
      background: "#0B1320",
      color: "white",
      padding: "40px 20px",
    }}>
      <div style={{ maxWidth: 680, margin: "auto" }}>
        <h1>UNIFY Wallet</h1>
        
        <section style={card}>
          <p>Available Balance</p>
          <h2 style={{ fontSize: 32, marginTop: 8 }}>
            {loading ? "Loading..." : peso(balance)}
          </h2>

          <input
            type="text"
            inputMode="decimal"
            placeholder="Amount in PHP"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            disabled={processing || loading}
            style={{
              width: "100%",
              padding: 12,
              marginTop: 18,
              marginBottom: 15,
              background: "white",
              color: "#111",
              borderRadius: 8,
            }}
          />

          <div style={{ display: "flex", gap: 12 }}>
            <button
              style={{ ...button, background: "#00D2FF" }}
              disabled={processing || loading}
              onClick={() => transfer("deposit")}
            >
              Deposit
            </button>

            <button
              style={{ ...button, background: "#10B981" }}
              disabled={processing || loading}
              onClick={() => transfer("withdraw")}
            >
              Withdraw
            </button>
          </div>

          {message && <p role="status">{message}</p>}
        </section>

        <section style={card}>
          <h2>Transaction History</h2>

          {history.length === 0 ? (
            <p>No transactions yet.</p>
          ) : (
            history.map(tx => (
              <div key={tx.id} style={{
                padding: "14px 0",
                borderBottom: "1px solid #29394F",
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
              }}>
                <div>
                  <strong>
                    {tx.transaction_type === "deposit"
                      ? "Deposit"
                      : "Withdrawal"}
                  </strong>
                  <div style={{ fontSize: 12, color: "#A6B5C8" }}>
                    {new Date(tx.created_at).toLocaleString()}
                  </div>
                </div>
                <strong>
                  {tx.transaction_type === "deposit" ? "+" : "-"}
                  {peso(tx.amount_centavos)}
                </strong>
              </div>
            ))
          )}
        </section>
      </div>
    </main>
  );
}
