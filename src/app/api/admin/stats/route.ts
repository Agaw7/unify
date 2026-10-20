import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;
const asNumber = (value: unknown) => Number(value ?? 0);
const cents = (value: unknown) => Math.round(asNumber(value) * 100);
const peso = (value: number) => value / 100;

function phDate(value: unknown): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(String(value)));
}

export async function GET(request: NextRequest) {
  try {
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  console.error("UNIFY ADMIN STATS CONFIG:", {
    supabaseUrl: Boolean(url),
    supabaseAnonKey: Boolean(anonKey),
    supabaseServiceRoleKey: Boolean(serviceKey),
  });

  return NextResponse.json(
    { error: "Missing server configuration." },
    { status: 500 }
  );
}

    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const authClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await authClient.auth.getUser(
      authorization.slice(7).trim()
    );
    if (authError || !auth.user) {
      return NextResponse.json({ error: "Invalid session." }, { status: 401 });
    }

    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("role")
      .eq("id", auth.user.id)
      .maybeSingle();
    if (profileError || profile?.role !== "admin") {
      return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
    }

    // Paginated reads; for large datasets use database-side aggregates.
    async function all(
      table: "profiles" | "payment_transactions" | "wallet_ledger" |
        "withdrawal_requests" | "withdrawal_payout_confirmations" | "sandbox_withdrawal_payouts",
      columns: string
    ): Promise<Row[]> {
      const rows: Row[] = [];
      const size = 500;
      for (let offset = 0; ; offset += size) {
        const { data, error } = await admin.from(table)
          .select(columns)
          .order("id", { ascending: true })
          .range(offset, offset + size - 1);
        if (error) throw new Error(`${table}: ${error.message}`);
        const batch = (data ?? []) as unknown as Row[];
        rows.push(...batch);
        if (batch.length < size) return rows;
      }
    }

    const [profiles, transactions, ledger, withdrawals] = await Promise.all([
      all("profiles", "id,created_at"),
      all("payment_transactions", "id,user_id,transaction_type,status,amount,currency,provider,created_at"),
      all("wallet_ledger", "id,transaction_id,user_id,entry_type,amount,created_at"),
      all("withdrawal_requests", "id,transaction_id,status,amount,currency"),
    ]);

    const today = phDate(new Date());
    const transactionById = new Map(transactions.map((tx) => [String(tx.id), tx]));
    const creditedTx = new Set<string>();
    let totalDepositCents = 0;
    let todayDepositCents = 0;
    let duplicateCreditEntries = 0;

    for (const entry of ledger) {
      if (entry.entry_type !== "deposit_credit") continue;
      const id = String(entry.transaction_id);
      const tx = transactionById.get(id);
      if (!tx || tx.transaction_type !== "deposit" || tx.status !== "completed" ||
          tx.provider !== "paymongo" || tx.currency !== "PHP" ||
          tx.user_id !== entry.user_id || cents(tx.amount) !== cents(entry.amount) ||
          cents(entry.amount) <= 0) continue;
      if (creditedTx.has(id)) {
        duplicateCreditEntries++;
        continue;
      }
      creditedTx.add(id);
      totalDepositCents += cents(entry.amount);
      if (phDate(entry.created_at) === today) todayDepositCents += cents(entry.amount);
    }

    const sumCents = (rows: Row[]) => rows.reduce((sum, row) => sum + cents(row.amount), 0);
    const processing = withdrawals.filter(
      (w) => w.status === "processing" && w.currency === "PHP"
    );
    const pending = withdrawals.filter(
      (w) => ["pending", "reserved", "processing"].includes(String(w.status)) &&
        w.currency === "PHP"
    );

    // Payout confirmations are only trustworthy if populated by a provider-
    // verified server-side reconciliation workflow. Reading the table does not
    // itself establish that such a workflow exists.
    const payoutReconciliationOperational =
      process.env.UNIFY_VERIFIED_PAYOUT_REPORTING === "true";
    let payoutConfirmations: Row[] = [];
    let payoutVerificationAvailable = false;
    let totalPaidCents = 0;
    let verifiedPayoutCount = 0;

    if (payoutReconciliationOperational) {
      try {
        payoutConfirmations = await all(
          "withdrawal_payout_confirmations",
          "id,withdrawal_request_id,provider,provider_reference,amount,currency,provider_status"
        );
        payoutVerificationAvailable = true;
      } catch (error) {
        console.error("UNIFY sandbox stats error:", error);

        return NextResponse.json(
          { error: "Unable to load sandbox statistics." },
          { status: 500 }
        );
      }
    }

    if (payoutVerificationAvailable) {
      const withdrawalById = new Map(withdrawals.map((w) => [String(w.id), w]));
      const countedWithdrawals = new Set<string>();
      for (const confirmation of payoutConfirmations) {
        const withdrawalId = String(confirmation.withdrawal_request_id);
        if (countedWithdrawals.has(withdrawalId)) continue;
        const withdrawal = withdrawalById.get(withdrawalId);
        if (!withdrawal) continue;
        const tx = transactionById.get(String(withdrawal.transaction_id));
        const valid =
          confirmation.provider_status === "paid" &&
          typeof confirmation.provider_reference === "string" &&
          confirmation.provider_reference.length > 0 &&
          confirmation.currency === "PHP" &&
          withdrawal.currency === "PHP" &&
          withdrawal.status === "completed" &&
          tx?.transaction_type === "withdrawal" &&
          tx.status === "completed" &&
          tx.currency === "PHP" &&
          cents(confirmation.amount) > 0 &&
          cents(confirmation.amount) === cents(withdrawal.amount) &&
          cents(tx.amount) === cents(withdrawal.amount);
        if (!valid) continue;
        countedWithdrawals.add(withdrawalId);
        totalPaidCents += cents(confirmation.amount);
        verifiedPayoutCount++;
      }
    }

    // Explicitly simulated payouts, NOT real verified GCash/Maya transfers.
const sandboxPayouts = await all(
  "sandbox_withdrawal_payouts",
  "id,withdrawal_request_id,transaction_id,amount,currency,status,created_at"
);
    const withdrawalById = new Map(withdrawals.map((w) => [String(w.id), w]));
    const seenSandbox = new Set<string>();
    let simulatedPaidCents = 0;
    let simulatedPaidCount = 0;
    for (const payout of sandboxPayouts) {
      const withdrawalId = String(payout.withdrawal_request_id);
      if (seenSandbox.has(withdrawalId)) continue;
      const withdrawal = withdrawalById.get(withdrawalId);
      const tx = transactionById.get(String(payout.transaction_id));
      if (!withdrawal || !tx || payout.is_simulated !== true ||
          withdrawal.status !== "completed" || tx.status !== "completed" ||
          tx.transaction_type !== "withdrawal" ||
          String(withdrawal.transaction_id) !== String(payout.transaction_id) ||
          String(tx.user_id) !== String(payout.user_id) ||
          withdrawal.currency !== "PHP" || tx.currency !== "PHP" ||
          payout.currency !== "PHP" || cents(payout.amount) <= 0 ||
          cents(payout.amount) !== cents(withdrawal.amount) ||
          cents(payout.amount) !== cents(tx.amount)) continue;
      seenSandbox.add(withdrawalId);
      simulatedPaidCents += cents(payout.amount);
      simulatedPaidCount++;
    }

    return NextResponse.json({
      currency: "PHP",
      timezone: "Asia/Manila",
      mode: "sandbox",
      totalMembers: profiles.length,
      signupsToday: profiles.filter((p) => phDate(p.created_at) === today).length,
      totalDeposits: peso(totalDepositCents),
      depositsToday: peso(todayDepositCents),
      verifiedDepositCount: creditedTx.size,
      pendingWithdrawals: peso(sumCents(pending)),
      processingWithdrawals: peso(sumCents(processing)),
      processingWithdrawalCount: processing.length,
      // Frontend displays the sandbox total with an explicit simulated label.
      totalWithdrawalsPaid: peso(simulatedPaidCents),
      simulatedWithdrawalsPaid: peso(simulatedPaidCents),
      simulatedPaidCount,
      realWithdrawalsPaid: payoutVerificationAvailable ? peso(totalPaidCents) : null,
      paidWithdrawalStatus: "simulated_only",
      realPaidWithdrawalStatus: payoutVerificationAvailable
        ? "verified_records_checked" : "not_verified",
      verifiedPayoutCount: payoutVerificationAvailable ? verifiedPayoutCount : null,
      paymongoBalance: null,
      paymongoBalanceStatus: "not_available_in_test_mode",
      duplicateCreditEntries,
      dateBasis: "wallet_ledger.deposit_credit.created_at",
      note: "Sandbox payout totals are simulations only. No GCash/Maya funds are sent.",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("UNIFY sandbox stats error:", error);
    return NextResponse.json(
      { error: "Unable to load sandbox statistics." },
      { status: 500 }
    );
  }
}
