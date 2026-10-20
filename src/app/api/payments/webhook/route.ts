
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";

// Validate Supabase transaction UUID.
function isValidUUID(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

// Verify PayMongo's test-mode webhook signature.
function verifySignature(
  rawBody: string,
  signatureHeader: string,
  secret: string
): boolean {
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((part) => {
      const [key, ...value] = part.trim().split("=");
      return [key, value.join("=")];
    })
  );

  const timestamp = parts.t;
  const signature = parts.te;

  if (!timestamp || !signature) return false;

  const timestampSeconds = Number(timestamp);

  if (
    !Number.isFinite(timestampSeconds) ||
    Math.abs(Date.now() / 1000 - timestampSeconds) > 300
  ) {
    return false;
  }

  if (!/^[a-f0-9]{64}$/i.test(signature)) {
    return false;
  }

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  return timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(signature, "hex")
  );
}

type CheckoutLineItem = {
  amount?: number;
  quantity?: number;
  currency?: string;
};

type CheckoutPayment = {
  attributes?: {
    status?: string;
  };
  status?: string;
};

export async function POST(request: NextRequest) {
  try {
    const secret = process.env.PAYMONGO_WEBHOOK_SECRET;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const paymongoKey = process.env.PAYMONGO_SECRET_KEY;

    if (
      !secret ||
      !url ||
      !serviceKey ||
      !paymongoKey ||
      !paymongoKey.startsWith("sk_test_")
    ) {
      console.error("Missing or invalid sandbox configuration");

      return NextResponse.json(
        { error: "Webhook not configured." },
        { status: 500 }
      );
    }

    // Step 1: Verify the webhook signature.
    const rawBody = await request.text();
    const signature = request.headers.get("paymongo-signature");

    if (!signature || !verifySignature(rawBody, signature, secret)) {
      console.error("Invalid PayMongo webhook signature");

      return NextResponse.json(
        { error: "Invalid webhook signature." },
        { status: 401 }
      );
    }

    // Step 2: Read the verified event.
    const payload = JSON.parse(rawBody);
    const event = payload?.data;
    const eventId = event?.id;
    const eventType = event?.attributes?.type;

    console.log("Verified PayMongo webhook event:", eventType);

    if (eventType !== "checkout_session.payment.paid") {
      return NextResponse.json({
        received: true,
        ignored: true,
      });
    }

    // Step 3: Extract checkout identifiers.
    const checkout = event?.attributes?.data;
    const checkoutId = checkout?.id;
    const referenceNumber = checkout?.attributes?.reference_number;

    console.log("Webhook deposit matching:", {
      eventType,
      checkoutId,
      hasReferenceNumber: typeof referenceNumber === "string",
      isValidReferenceUUID: isValidUUID(referenceNumber),
    });

    if (
      typeof eventId !== "string" ||
      typeof checkoutId !== "string" ||
      !isValidUUID(referenceNumber)
    ) {
      console.error("Webhook missing or invalid transaction UUID");

      return NextResponse.json(
        { error: "Invalid checkout reference." },
        { status: 400 }
      );
    }

    // Step 4: Find the matching Supabase transaction.
    const supabase = createClient(url, serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { data: transaction, error: lookupError } =
      await supabase
        .from("payment_transactions")
        .select("id, amount, currency, status")
        .eq("id", referenceNumber)
        .eq("provider_reference", checkoutId)
        .eq("transaction_type", "deposit")
        .eq("provider", "paymongo")
        .maybeSingle();

    if (lookupError || !transaction) {
      console.error("No matching deposit transaction", {
        lookupError: lookupError?.message,
      });

      return NextResponse.json(
        { error: "Deposit transaction not found." },
        { status: 400 }
      );
    }

    console.log("UNIFY deposit transaction found:", {
      status: transaction.status,
      amount: transaction.amount,
      currency: transaction.currency,
    });

    if (
      transaction.status !== "pending" &&
      transaction.status !== "completed"
    ) {
      return NextResponse.json(
        { error: "Invalid deposit transaction status." },
        { status: 409 }
      );
    }

    // Step 5: Independently retrieve PayMongo checkout.
    const checkoutResponse = await fetch(
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

    if (!checkoutResponse.ok) {
      console.error(
        "PayMongo checkout verification failed:",
        checkoutResponse.status
      );

      return NextResponse.json(
        { error: "Unable to verify checkout." },
        { status: 502 }
      );
    }

    const checkoutResult = await checkoutResponse.json();
    const verified = checkoutResult?.data?.attributes;

    const paymentIntentStatus =
      verified?.payment_intent?.attributes?.status;

    const payments: CheckoutPayment[] =
      Array.isArray(verified?.payments)
        ? verified.payments
        : [];

    const paymentStatuses = payments.map(
      (payment) =>
        payment.attributes?.status ?? payment.status ?? null
    );

    console.log("PayMongo checkout verification:", {
      idMatches: checkoutResult?.data?.id === checkoutId,
      checkoutStatus: verified?.status,
      paymentIntentStatus,
      paymentStatuses,
    });

    // Step 6: Verify checkout identity and paid status.
    if (
      checkoutResult?.data?.id !== checkoutId ||
      verified?.reference_number !== transaction.id ||
      paymentIntentStatus !== "succeeded" ||
      !paymentStatuses.includes("paid")
    ) {
      console.error("Checkout payment not verified as paid");

      return NextResponse.json(
        { error: "Payment success not verified." },
        { status: 409 }
      );
    }

    // Step 7: Verify transaction amount in centavos.
    const amountCentavos = Math.round(
      Number(transaction.amount) * 100
    );

    if (
      transaction.currency !== "PHP" ||
      !Number.isSafeInteger(amountCentavos) ||
      amountCentavos <= 0
    ) {
      return NextResponse.json(
        { error: "Invalid transaction amount." },
        { status: 400 }
      );
    }

    // Step 8: Verify PayMongo line items.
    const lineItems: CheckoutLineItem[] = verified?.line_items;

    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      console.error("Missing checkout line items");

      return NextResponse.json(
        { error: "Missing checkout amount." },
        { status: 409 }
      );
    }

    let checkoutAmount = 0;

    for (const item of lineItems) {
      const itemAmount = Number(item.amount);
      const quantity = Number(item.quantity);

      if (
        item.currency !== "PHP" ||
        !Number.isSafeInteger(itemAmount) ||
        itemAmount <= 0 ||
        !Number.isSafeInteger(quantity) ||
        quantity <= 0
      ) {
        console.error("Invalid checkout line item");

        return NextResponse.json(
          { error: "Invalid checkout line item." },
          { status: 409 }
        );
      }

      checkoutAmount += itemAmount * quantity;
    }

    console.log("Payment amount verification:", {
      transactionAmountCentavos: amountCentavos,
      checkoutAmountCentavos: checkoutAmount,
    });

    if (
      !Number.isSafeInteger(checkoutAmount) ||
      checkoutAmount !== amountCentavos
    ) {
      console.error("Checkout amount does not match");

      return NextResponse.json(
        { error: "Payment amount mismatch." },
        { status: 409 }
      );
    }

    // Step 9: Atomically credit the verified sandbox deposit.
    // The database function must enforce idempotency.
    const { error: creditError } = await supabase.rpc(
      "credit_verified_deposit",
      {
        p_event_id: eventId,
        p_checkout_id: checkoutId,
        p_reference_number: transaction.id,
        p_amount_centavos: amountCentavos,
        p_currency: "PHP",
      }
    );

    if (creditError) {
      console.error("UNIFY wallet credit error:", {
        code: creditError.code,
        message: creditError.message,
      });

      return NextResponse.json(
        { error: "Unable to credit verified payment." },
        { status: 500 }
      );
    }

    console.log("UNIFY verified sandbox deposit processed");

    return NextResponse.json({
      received: true,
      credited: true,
    });
  } catch (error) {
    console.error("UNIFY webhook error:", error);

    return NextResponse.json(
      { error: "Webhook processing failed." },
      { status: 500 }
    );
  }
}
