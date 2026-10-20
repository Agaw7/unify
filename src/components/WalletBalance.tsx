
"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function WalletBalance() {
  const [balance, setBalance] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadWallet() {
    setLoading(true);
    setError("");

    // Get currently logged-in user.
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      setError("Please log in first.");
      setLoading(false);
      return;
    }

    // Fetch balance from UNIFY Supabase database.
    const { data, error: walletError } = await supabase
      .from("wallet_accounts")
      .select("balance, currency")
      .eq("user_id", user.id)
      .maybeSingle();

    if (walletError) {
      console.error(walletError);
      setError("Failed to load wallet.");
    } else {
      setBalance(Number(data?.balance ?? 0));
    }

    setLoading(false);
  }

  useEffect(() => {
    void loadWallet();
  }, []);

  return (
    <div className="rounded-xl bg-slate-900 p-6 text-white">
      <p className="text-sm text-gray-400">
        UNIFY Wallet Balance
      </p>

      {loading ? (
        <p>Loading...</p>
      ) : error ? (
        <p className="text-red-400">{error}</p>
      ) : (
        <h2 className="mt-2 text-3xl font-bold">
          ₱{balance.toLocaleString("en-PH", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </h2>
      )}

      <button
        onClick={() => void loadWallet()}
        className="mt-4 rounded-lg bg-blue-600 px-4 py-2"
      >
        Refresh Balance
      </button>
    </div>
  );
}
