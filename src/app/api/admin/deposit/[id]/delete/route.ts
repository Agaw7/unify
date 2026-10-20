
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

type PayMongoCheckout = {
  data?: {
    id?: string;
    attributes?: {
      reference_number?: string;
      status?: string;
      livemode?: boolean;
      payment_intent?: {
        attributes?: { status?: string };
      };
      payments?: Array<{
        attributes?: { status?: string };
      }>;
    };
  };
};

export async function DELETE(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params;

    if (!uuidPattern.test(id)) {
      return fail("Invalid transaction ID.", 400);
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const paymongoKey = process.env.PAYMONGO_SECRET_KEY;

    if (!url || !anonKey || !serviceKey || !paymongoKey) {
      return fail("Missing server configuration.", 500);
    }

    if (!paymongoKey.startsWith("sk_test_")) {
      return fail("PayMongo sandbox mode required.", 403);
    }

    const authorization = request.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
      return fail("Authentication required.", 401);
    }

    const authClient = createClient(url, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { data: auth, error: authError } =
      await authClient.auth.getUser(
        authorization.slice(7).trim()
      );

    if (authError || !auth.user) {
      return fail("Invalid administrator session.", 401);
    }

    const admin = createClient(url, serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { data: profile, error: profileError } =
      await admin
        .from("profiles")
        .select("role")
        .eq("id", auth.user.id)
        .single();

    if (profileError || profile?.role !== "admin") {
      return fail("Administrator access required.", 403);
    }

    const { data: tx, error: txError } =
      await admin
        .from("payment_transactions")
        .select(
          "id, status, transaction_type, provider, provider_reference"
        )
        .eq("id", id)
        .single();

    if (txError || !tx) {
      return fail("Deposit not found.", 404);
    }

    if (
      tx.transaction_type !== "deposit" ||
      tx.provider !== "paymongo" ||
      tx.status !== "pending"
    ) {
      return fail(
        "Only pending PayMongo deposits can be cancelled.",
        409
      );
    }

    const checkoutId = tx.provider_reference;

    if (
      typeof checkoutId !== "string" ||
      !checkoutId.startsWith("cs_")
    ) {
      return fail(
        "Missing checkout ID. Manual review required.",
        409
      );
    }

    const headers = {
      Authorization:
        "Basic " +
        Buffer.from(`${paymongoKey}:`).toString("base64"),
      Accept: "application/json",
    };

    const checkoutUrl =
      `https://api.paymongo.com/v1/checkout_sessions/` +
      encodeURIComponent(checkoutId);

    // Retrieve the current checkout state.
    const checkResponse = await fetch(checkoutUrl, {
      headers,
      cache: "no-store",
    });

    if (!checkResponse.ok) {
      return fail(
        "Unable to verify checkout with PayMongo.",
        502
      );
    }

    const checkResult =
      (await checkResponse.json()) as PayMongoCheckout;

    const checkout = checkResult.data;
    const attributes = checkout?.attributes;

    if (
      checkout?.id !== checkoutId ||
      attributes?.reference_number !== tx.id ||
      attributes?.livemode !== false
    ) {
      return fail("Checkout identity mismatch.", 409);
    }

    const payments = attributes?.payments;

    // Missing payment data is not proof of nonpayment.
    if (!Array.isArray(payments)) {
      return fail(
        "Payment information unavailable. Manual review required.",
        409
      );
    }

    const intentStatus =
      attributes?.payment_intent?.attributes?.status;

    const paymentStatuses = payments.map(
      (payment) => payment.attributes?.status
    );

    if (
      intentStatus === "succeeded" ||
      paymentStatuses.includes("paid") ||
      paymentStatuses.includes("succeeded")
    ) {
      return fail(
        "Payment already succeeded. Verify and reconcile it instead.",
        409
      );
    }

    if (
      intentStatus === "processing" ||
      paymentStatuses.some(
        (status) =>
          status === "pending" || status === "processing"
      )
    ) {
      return fail(
        "Payment is pending or processing. Cancellation is blocked.",
        409
      );
    }

    // Expire an active checkout through PayMongo.
    if (attributes?.status === "active") {
      const expireResponse = await fetch(
        `${checkoutUrl}/expire`,
        {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
          },
          cache: "no-store",
        }
      );

      if (!expireResponse.ok) {
        return fail(
          "PayMongo could not expire this checkout. Payment may be in progress. No database changes were made.",
          409
        );
      }
    } else if (attributes?.status !== "expired") {
      return fail(
        "Unknown checkout status. Cancellation blocked.",
        409
      );
    }

    // Verify that PayMongo now reports an expired checkout.
    const finalResponse = await fetch(checkoutUrl, {
      headers,
      cache: "no-store",
    });

    if (!finalResponse.ok) {
      return fail(
        "Unable to confirm checkout expiration.",
        502
      );
    }

    const finalResult =
      (await finalResponse.json()) as PayMongoCheckout;

    const finalCheckout = finalResult.data;
    const finalAttributes = finalCheckout?.attributes;

    if (
      finalCheckout?.id !== checkoutId ||
      finalAttributes?.reference_number !== tx.id ||
      finalAttributes?.livemode !== false ||
      finalAttributes?.status !== "expired" ||
      !Array.isArray(finalAttributes?.payments)
    ) {
      return fail(
        "Checkout expiration could not be verified.",
        409
      );
    }

    if (
      finalAttributes.payment_intent?.attributes?.status ===
        "succeeded" ||
      finalAttributes.payments.some(
        (payment) =>
          payment.attributes?.status === "paid" ||
          payment.attributes?.status === "succeeded" ||
          payment.attributes?.status === "pending" ||
          payment.attributes?.status === "processing"
      )
    ) {
      return fail(
        "Payment state requires reconciliation.",
        409
      );
    }

    // Check for existing wallet entries.
    const { data: ledger, error: ledgerError } =
      await admin
        .from("wallet_ledger")
        .select("id")
        .eq("transaction_id", id)
        .limit(1);

    if (ledgerError) {
      return fail("Unable to verify wallet ledger.", 500);
    }

    if (ledger && ledger.length > 0) {
      return fail(
        "Deposit already has wallet ledger entries.",
        409
      );
    }

    // Preserve the transaction record for auditing.
    const { data: cancelled, error: updateError } =
      await admin
        .from("payment_transactions")
        .update({ status: "cancelled" })
        .eq("id", id)
        .eq("status", "pending")
        .eq("transaction_type", "deposit")
        .eq("provider", "paymongo")
        .eq("provider_reference", checkoutId)
        .select("id, status")
        .maybeSingle();

    if (updateError) {
      console.error("Cancellation update error:", updateError.message);
      return fail(
        "Checkout expired, but the database update failed. Refresh and reconcile the transaction.",
        500
      );
    }

    if (!cancelled) {
      return fail(
        "Checkout expired, but the transaction changed concurrently. Refresh and reconcile.",
        409
      );
    }

    return NextResponse.json({
      success: true,
      message: "Sandbox checkout expired and deposit cancelled.",
      transaction: cancelled,
    });
  } catch (error) {
    console.error("Deposit cancellation error:", error);
    return fail("Unable to cancel sandbox deposit.", 500);
  }
}
