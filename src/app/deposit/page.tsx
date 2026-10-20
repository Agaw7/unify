
"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

type PaymentMethod = "gcash" | "maya";

export default function DepositPage() {
  const [amount, setAmount] = useState("200");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  
  // Handle GCash and Maya deposits
  async function handleDeposit(
    depositAmount: number,
    paymentMethod: PaymentMethod
  ) {
    if (loading) return;

    setLoading(true);
    setError("");

    try {
      // Validate deposit amount
      if (
        !Number.isFinite(depositAmount) ||
        depositAmount < 200 ||
        depositAmount > 50000 ||
        Math.abs(
          depositAmount * 100 -
          Math.round(depositAmount * 100)
        ) > 0.000001
      ) {
        throw new Error(
          "Enter a valid deposit amount from ₱200 to ₱50,000."
        );
      }

// Get the logged-in user's session
const {
  data: { session },
  error: sessionError,
} = await supabase.auth.getSession();

if (sessionError || !session?.access_token) {
  throw new Error("Please log in to UNIFY first.");
}

// Send the authenticated deposit request
const response = await fetch("/api/payments/deposit", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.access_token}`,
  },
  body: JSON.stringify({
    amount: depositAmount,
    paymentMethod,
  }),
});

      // Check API response format
      const contentType =
        response.headers.get("content-type") || "";

      if (!contentType.includes("application/json")) {
        throw new Error(
          `Deposit API returned HTTP ${response.status} instead of JSON. Check your Next.js API route.`
        );
      }

      const result = await response.json();

      // Handle API errors
      if (!response.ok) {
        throw new Error(
          result.error ||
          result.message ||
          "Unable to create deposit."
        );
      }

      // Verify PayMongo checkout URL
      if (
        typeof result.checkoutUrl !== "string" ||
        !result.checkoutUrl.startsWith("https://")
      ) {
        throw new Error(
          "PayMongo checkout URL is missing or invalid."
        );
      }

      // Redirect to PayMongo checkout
      window.location.assign(result.checkoutUrl);

    } catch (err) {
      console.error("UNIFY deposit error:", err);

      setError(
        err instanceof Error
          ? err.message
          : "An unexpected error occurred."
      );

    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-white">
      <div className="mx-auto max-w-md space-y-6">

        {/* HEADER */}
        <div>
          <h1 className="text-3xl font-bold">
            UNIFY Deposit
          </h1>

          <p className="mt-2 text-sm text-slate-400">
            Add funds to your UNIFY sandbox wallet
            using PayMongo test checkout.
          </p>
        </div>

        {/* DEPOSIT AMOUNT */}
        <div className="space-y-2">
          <label
            htmlFor="deposit-amount"
            className="block text-sm font-medium"
          >
            Deposit Amount (PHP)
          </label>

          <input
            id="deposit-amount"
            type="number"
            min="200"
            max="50000"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={loading}
            placeholder="Enter deposit amount"
            className="w-full rounded-xl border border-slate-700 bg-slate-800 p-4 text-white outline-none focus:border-blue-500"
          />

          <p className="text-sm text-slate-400">
            Minimum: ₱200 | Maximum: ₱50,000
          </p>
        </div>

        {/* PAYMENT METHODS */}
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">
            Select Payment Method
          </h2>

          {/* GCASH */}
          <button
            type="button"
            onClick={() =>
              handleDeposit(Number(amount), "gcash")
            }
            disabled={loading}
            className="w-full rounded-xl bg-blue-600 p-4 font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading
              ? "Processing..."
              : "Deposit using GCash"}
          </button>

          {/* MAYA */}
          <button
            type="button"
            onClick={() =>
              handleDeposit(Number(amount), "maya")
            }
            disabled={loading}
            className="w-full rounded-xl bg-green-600 p-4 font-semibold text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading
              ? "Processing..."
              : "Deposit using Maya"}
          </button>
        </div>

        {/* ERROR MESSAGE */}
        {error && (
          <div
            role="alert"
            className="rounded-xl border border-red-500 bg-red-950 p-4 text-sm text-red-300"
          >
            {error}
          </div>
        )}

        {/* BACK BUTTON */}
        <button
          type="button"
          onClick={() => window.location.assign("/")}
          disabled={loading}
          className="w-full rounded-xl border border-slate-700 p-4 font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-50"
        >
          Back to Dashboard
        </button>

      </div>
    </main>
  );
}
