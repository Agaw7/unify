import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";


 export const runtime = "nodejs";

const MAX_AGE_SECONDS = 300;

type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getRecord(value: unknown, key: string): JsonObject | null {
  if (!isRecord(value)) return null;
  const nested = value[key];
  return isRecord(nested) ? nested : null;
}
  
  function verifySignature(rawBody: string, header: string, secret: string): boolean {
  const parts: Record<string, string> = {};
  for (const part of header.split(",")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    parts[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }

  const timestamp = parts.t;
  const signature = parts.te; // PayMongo Test Mode signature
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (age > MAX_AGE_SECONDS) return false;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest();

  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
  const received = Buffer.from(signature, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export async function POST(request: NextRequest) {
  const secret = process.env.PAYMONGO_WEBHOOK_SECRET;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!secret || !url || !serviceKey) {
    console.error("Webhook configuration missing");
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const rawBody = await request.text();
  const signatureHeader = request.headers.get("paymongo-signature");
  if (!signatureHeader || !verifySignature(rawBody, signatureHeader, secret)) {
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const event = getRecord(payload, "data");
  const attributes = getRecord(event, "attributes");

  // This endpoint deliberately accepts sandbox/test events only.
  if ((process.env.PAYMONGO_MODE ?? "test") !== "test") {
    return NextResponse.json({ error: "UNIFY webhook requires PayMongo Test Mode" }, { status: 500 });
  }
  if (attributes?.livemode !== false) {
    console.error("PayMongo environment mismatch");
    return NextResponse.json({ error: "Payment environment mismatch" }, { status: 400 });
  }

  if (attributes.type !== "checkout_session.payment.paid") {
    return NextResponse.json({ received: true, ignored: true });
  }

  const checkout = getRecord(attributes, "data");
  const checkoutId = checkout?.id;
  const checkoutAttributes = getRecord(checkout, "attributes");
  const reference = checkoutAttributes?.reference_number;
  const payments = checkoutAttributes?.payments;
  const paidPayments = Array.isArray(payments)
    ? payments.filter((payment: unknown) => getRecord(payment, "attributes")?.status === "paid")
    : [];

  if (
    typeof event?.id !== "string" ||
    typeof checkoutId !== "string" ||
    !/^cs_/.test(checkoutId) ||
    typeof reference !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reference) ||
    paidPayments.length !== 1
  ) {
    return NextResponse.json({ error: "Invalid checkout payload" }, { status: 400 });
  }

  const paymentAttributes = getRecord(paidPayments[0], "attributes");
  const source = getRecord(paymentAttributes, "source");
  const sourceType = source?.type;

  if (sourceType !== "gcash" && sourceType !== "paymaya") {
    return NextResponse.json({ error: "Unsupported payment method" }, { status: 400 });
  }

  const amount = paymentAttributes?.amount;
  const currency = paymentAttributes?.currency;
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0 || currency !== "PHP") {
    return NextResponse.json({ error: "Invalid payment amount" }, { status: 400 });
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: transaction, error: lookupError } = await supabase
    .from("payment_transactions")
    .select("id, payment_method, provider_reference, status")
    .eq("id", reference)
    .single();

  if (lookupError || !transaction) {
    console.error("Unknown deposit reference:", reference);
    return NextResponse.json({ error: "Transaction not found" }, { status: 500 });
  }

  const expectedMethod = transaction.payment_method === "maya" ? "paymaya" : transaction.payment_method;
  if (transaction.provider_reference !== checkoutId || expectedMethod !== sourceType) {
    return NextResponse.json({ error: "Checkout mismatch" }, { status: 400 });
  }

  // RPC must enforce idempotency, amount verification, and test-only crediting atomically.
  const { data: result, error: rpcError } = await supabase.rpc("credit_sandbox_deposit", {
    p_event_id: event.id,
    p_checkout_id: checkoutId,
    p_reference_number: reference,
    p_amount_centavos: amount,
    p_currency: currency,
  });

  if (rpcError) {
    console.error("Deposit credit failed:", rpcError);
    return NextResponse.json({ error: "Unable to process deposit" }, { status: 500 });
  }

  return NextResponse.json({ received: true, result });
}