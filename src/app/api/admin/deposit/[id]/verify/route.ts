
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params;

    if (!uuidPattern.test(id)) {
      return errorResponse("Invalid transaction ID.", 400);
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const paymongoKey = process.env.PAYMONGO_SECRET_KEY;

    if (!url || !anonKey || !serviceKey || !paymongoKey) {
      return errorResponse("Missing server configuration.", 500);
    }

    if (!paymongoKey.startsWith("sk_test_")) {
      return errorResponse("PayMongo Test Mode is required.", 500);
    }

    const authorization = request.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
      return errorResponse("Authentication required.", 401);
    }

    const token = authorization.slice(7).trim();

    const authClient = createClient(url, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { data: auth, error: authError } =
      await authClient.auth.getUser(token);

    if (authError || !auth.user) {
      return errorResponse("Invalid administrator session.", 401);
    }

    const admin = createClient(url, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Verify administrator permissions on the server.
    const { data: profile, error: profileError } =
      await admin
        .from("profiles")
        .select("role")
        .eq("id", auth.user.id)
        .single();

    if (profileError || profile?.role !== "admin") {
      return errorResponse("Administrator access required.", 403);
    }

    // Retrieve the original deposit transaction.
    const { data: transaction, error: txError } =
      await admin
        .from("payment_transactions")
        .select(
          "id, user_id, amount, currency, status, provider, provider_reference, transaction_type"
        )
        .eq("id", id)
        .single();

    if (txError || !transaction) {
      return errorResponse("Deposit not found.", 404);
    }

    if (
      transaction.transaction_type !== "deposit" ||
      transaction.provider !== "paymongo"
    ) {
      return errorResponse("Not a PayMongo deposit.", 400);
    }

    if (transaction.status === "completed") {
      return NextResponse.json({
        success: true,
        result: "already_paid",
      });
    }

    if (transaction.status !== "pending") {
      return errorResponse("Deposit is not pending.", 409);
    }

    const checkoutId = transaction.provider_reference;

    if (
      typeof checkoutId !== "string" ||
      !checkoutId.startsWith("cs_")
    ) {
      return errorResponse("Missing PayMongo checkout ID.", 400);
    }

    // Retrieve checkout directly from PayMongo.
    const response = await fetch(
      `https://api.paymongo.com/v1/checkout_sessions/${encodeURIComponent(checkoutId)}`,
      {
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(`${paymongoKey}:`).toString("base64"),
          Accept: "application/json",
        },
        cache: "no-store",
      }
    );

    if (!response.ok) {
      console.error("PayMongo verification HTTP status:", response.status);
      return errorResponse("Unable to verify PayMongo payment.", 502);
    }

    const checkoutResult = await response.json();
    const checkout = checkoutResult?.data;
    const attributes = checkout?.attributes;

    // Only log status diagnostics, not credentials or personal data.
    const paymentIntentStatus =
      attributes?.payment_intent?.attributes?.status ?? null;

    const paymentStatuses = Array.isArray(attributes?.payments)
      ? attributes.payments.map(
          (payment: { attributes?: { status?: string } }) =>
            payment.attributes?.status ?? null
        )
      : [];

    console.log("PayMongo verification diagnostics:", {
      checkoutIdMatches: checkout?.id === checkoutId,
      referenceMatches:
        attributes?.reference_number === transaction.id,
      checkoutStatus: attributes?.status ?? null,
      paymentIntentStatus,
      paymentStatuses,
      lineItemsPresent: Array.isArray(attributes?.line_items),
    });

    // Checkout must belong to the original transaction.
    if (
      checkout?.id !== checkoutId ||
      attributes?.reference_number !== transaction.id
    ) {
      return errorResponse("Checkout reference mismatch.", 409);
    }

    // Require positive evidence of successful payment.
    // Do not treat checkout creation or redirects as proof.
    const intentSucceeded = paymentIntentStatus === "succeeded";

    const paymentSucceeded = paymentStatuses.some(
      (status: string | null) =>
        status === "paid" || status === "succeeded"
    );

    if (!intentSucceeded && !paymentSucceeded) {
      return errorResponse(
        "Payment success not verified. Check server diagnostics.",
        409
      );
    }

    // Validate the transaction amount.
    const amountCentavos = Math.round(
      Number(transaction.amount) * 100
    );

    if (
      transaction.currency !== "PHP" ||
      !Number.isSafeInteger(amountCentavos) ||
      amountCentavos <= 0
    ) {
      return errorResponse("Invalid transaction amount.", 400);
    }

    // Verify the exact checkout amount.
    const lineItems = attributes?.line_items;

    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      return errorResponse("Missing checkout line items.", 409);
    }

    let checkoutAmount = 0;

    for (const item of lineItems) {
      const itemAmount = item?.amount;
      const quantity = item?.quantity;

      if (
        item?.currency !== "PHP" ||
        typeof itemAmount !== "number" ||
        !Number.isSafeInteger(itemAmount) ||
        itemAmount <= 0 ||
        typeof quantity !== "number" ||
        !Number.isSafeInteger(quantity) ||
        quantity <= 0
      ) {
        return errorResponse("Invalid checkout line item.", 409);
      }

      checkoutAmount += itemAmount * quantity;

      if (!Number.isSafeInteger(checkoutAmount)) {
        return errorResponse("Invalid checkout total.", 409);
      }
    }

    console.log("Payment amount verification:", {
      amountMatches: checkoutAmount === amountCentavos,
    });

    if (checkoutAmount !== amountCentavos) {
      return errorResponse("Payment amount mismatch.", 409);
    }

    // Deterministic ID for this admin reconciliation.
    // The database function must remain atomic and idempotent.
    const reconciliationId =
      `admin_reconcile_${transaction.id}`;

    const { data: result, error: creditError } =
      await admin.rpc("credit_verified_deposit", {
        p_event_id: reconciliationId,
        p_checkout_id: checkoutId,
        p_reference_number: transaction.id,
        p_amount_centavos: amountCentavos,
        p_currency: "PHP",
      });

    if (creditError) {
      console.error("Deposit reconciliation error:", {
        code: creditError.code,
        message: creditError.message,
      });

      return errorResponse(
        "Unable to reconcile verified deposit.",
        500
      );
    }

    console.log("Admin sandbox deposit reconciliation:", result);

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (error) {
    console.error("Admin deposit verification error:", error);

    return errorResponse("Deposit verification failed.", 500);
  }
}
