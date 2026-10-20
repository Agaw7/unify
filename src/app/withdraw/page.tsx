"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type PaymentAccount = {
  id: string;
  provider: "gcash" | "maya";
  account_name: string;
  account_number: string;
};

type Withdrawal = {
  id: string;
  amount: number;
  currency: string;
  payment_method: string | null;
  status: string;
  created_at: string;
};

function peso(amount: number) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(amount);
}

export default function WithdrawPage() {
  const [amount, setAmount] = useState("100");
  const [accountId, setAccountId] = useState("");
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [history, setHistory] = useState<Withdrawal[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const requestKey = useRef<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) throw new Error("Please sign in to UNIFY first.");
      const userId = authData.user.id;
      const [accountResult, walletResult, historyResult] = await Promise.all([
        supabase.from("payment_accounts")
          .select("id, provider, account_name, account_number")
          .eq("user_id", userId).order("created_at", { ascending: false }),
        supabase.from("sandbox_wallets")
          .select("remaining_balance").eq("user_id", userId).maybeSingle(),
        supabase.from("sandbox_withdrawal_requests")
          .select("id, amount, currency, payment_method, status, created_at")
          .eq("user_id", userId).order("created_at", { ascending: false }),
      ]);
      if (accountResult.error) throw new Error(accountResult.error.message);
      if (walletResult.error) throw new Error(walletResult.error.message);
      if (historyResult.error) throw new Error(historyResult.error.message);
      const saved = (accountResult.data ?? []) as PaymentAccount[];
      setAccounts(saved);
      setAccountId((previous) => saved.some((a) => a.id === previous)
        ? previous : saved[0]?.id ?? "");
      setBalance(walletResult.data ? Number(walletResult.data.remaining_balance) : 0);
      setHistory((historyResult.data ?? []) as Withdrawal[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load withdrawal details.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  async function submitWithdrawal() {
    if (submitting) return;
    setError("");
    setMessage("");
    const withdrawalAmount = Number(amount);
    if (!Number.isFinite(withdrawalAmount) || withdrawalAmount < 100 ||
        withdrawalAmount > 50000 ||
        Math.round(withdrawalAmount * 100) !== withdrawalAmount * 100) {
      setError("Enter an amount from ₱100 to ₱50,000.");
      return;
    }
    if (balance === null || withdrawalAmount > balance) {
      setError("Insufficient simulated Remaining Balance.");
      return;
    }
    if (!accountId) {
      setError("Select a saved GCash or Maya account.");
      return;
    }
    setSubmitting(true);
    try {
      if (!requestKey.current) requestKey.current = crypto.randomUUID();
      const { data, error: rpcError } = await supabase.rpc(
        "request_sandbox_withdrawal",
        {
          p_amount: withdrawalAmount,
          p_payment_account_id: accountId,
          p_idempotency_key: requestKey.current,
        }
      );
      if (rpcError) throw new Error(rpcError.message);
      requestKey.current = null;
      setMessage(`Simulated withdrawal reserved (${String(data?.status ?? "reserved")}). No real GCash/Maya transfer occurred.`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Withdrawal request failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 p-5 text-white">
      <div className="mx-auto max-w-lg space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold">UNIFY Simulated Withdrawal</h1>
          <p className="text-sm text-slate-400">Test Mode only. No real money is transferred.</p>
        </header>

        <section className="rounded-2xl bg-slate-900 p-5">
          <p className="text-sm text-slate-400">Remaining Balance (simulated)</p>
          <p className="mt-2 text-3xl font-bold">{balance === null ? "—" : peso(balance)}</p>
          <p className="mt-2 text-xs text-slate-400">
            Includes simulated bonus, claimed daily credits and eligible simulated commissions.
            Deposit Balance is excluded. Minimum simulated withdrawal: ₱100.
          </p>
        </section>

        <section className="space-y-4 rounded-2xl bg-slate-900 p-5">
          <h2 className="text-lg font-semibold">Request Simulated Withdrawal</h2>
          <div className="space-y-2">
            <label htmlFor="withdraw-amount" className="block text-sm">Amount (PHP)</label>
            <input id="withdraw-amount" type="number" min="100" max="50000"
              step="0.01" value={amount}
              onChange={(e) => { setAmount(e.target.value); requestKey.current = null; }}
              className="w-full rounded-xl border border-slate-700 bg-slate-800 p-3" />
          </div>
          <div className="space-y-2">
            <label htmlFor="withdraw-account" className="block text-sm">GCash or Maya (simulation label)</label>
            <select id="withdraw-account" value={accountId}
              onChange={(e) => { setAccountId(e.target.value); requestKey.current = null; }}
              className="w-full rounded-xl border border-slate-700 bg-slate-800 p-3">
              {accounts.length === 0 && <option value="">No saved accounts</option>}
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.provider.toUpperCase()} — {account.account_name} — ****{account.account_number.slice(-4)}
                </option>
              ))}
            </select>
            {accounts.length === 0 && (
              <p className="text-sm text-amber-300">Add a saved GCash or Maya account under Me → Bank Account.</p>
            )}
          </div>
          <button type="button" onClick={submitWithdrawal}
            disabled={submitting || loading || !accountId || balance === null || balance < 100}
            className="w-full rounded-xl bg-blue-600 p-3 font-semibold disabled:opacity-50">
            {submitting ? "Submitting..." : "Request Simulated Withdrawal"}
          </button>
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
          {message && <p role="status" className="text-sm text-green-400">{message}</p>}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Simulated Withdrawal History</h2>
          {history.length === 0 ? (
            <p className="text-sm text-slate-400">No simulated withdrawal requests yet.</p>
          ) : history.map((item) => (
            <div key={item.id} className="rounded-xl bg-slate-900 p-4">
              <div className="flex justify-between gap-3">
                <p className="font-semibold">{peso(Number(item.amount))}</p>
                <span className="text-sm capitalize text-blue-300">{item.status.replaceAll("_", " ")}</span>
              </div>
              <p className="mt-1 text-sm text-slate-400">{item.payment_method?.toUpperCase() ?? "Sandbox"} · Simulated only</p>
              <p className="mt-2 text-xs text-slate-500">{new Date(item.created_at).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}</p>
            </div>
          ))}
        </section>
        <button type="button" onClick={() => window.location.assign("/")}
          className="w-full rounded-xl border border-slate-700 p-3">Back to Dashboard</button>
      </div>
    </main>
  );
}
