
require("dotenv").config({ path: ".env.local" });

const { createClient } = require("@supabase/supabase-js");

const transactionId = process.argv[2];
const confirm = process.argv[3];

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if (!uuidPattern.test(transactionId || "")) {
  console.error("Provide a valid transaction UUID.");
  process.exit(1);
}

const {
  NEXT_PUBLIC_SUPABASE_URL: url,
  SUPABASE_SERVICE_ROLE_KEY: serviceKey,
  PAYMONGO_SECRET_KEY: paymongoKey,
} = process.env;

if (
  !url ||
  !serviceKey ||
  !paymongoKey?.startsWith("sk_test_")
) {
  console.error("Missing sandbox configuration.");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

async function main() {
  const { data: tx, error: txError } = await supabase
    .from("payment_transactions")
    .select(
      "id, amount, currency, status, provider, provider_reference, transaction_type"
    )
    .eq("id", transactionId)
    .single();

  if (txError || !tx) {
    throw new Error("Transaction not found.");
  }

  if (
    tx.transaction_type !== "deposit" ||
    tx.provider !== "paymongo" ||
    tx.currency !== "PHP" ||
    !["pending", "completed"].includes(tx.status) ||
    !/^cs_[A-Za-z0-9]+$/.test(tx.provider_reference || "")
  ) {
    throw new Error("Invalid deposit transaction.");
  }

  const checkoutId = tx.provider_reference;

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
    throw new Error(
      `PayMongo verification failed: HTTP ${response.status}`
    );
  }

  const result = await response.json();
  const attributes = result?.data?.attributes;

  const intentStatus =
    attributes?.payment_intent?.attributes?.status;

  const payments = attributes?.payments;

  const paid = Array.isArray(payments) &&
    payments.some(
      (payment) =>
        (payment.attributes?.status ?? payment.status) === "paid"
    );

  if (
    result?.data?.id !== checkoutId ||
    attributes?.reference_number !== tx.id ||
    intentStatus !== "succeeded" ||
    !paid
  ) {
    throw new Error("Payment verification failed.");
  }

  const items = attributes?.line_items;

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Missing checkout line items.");
  }

  let checkoutCentavos = 0;

  for (const item of items) {
    if (
      item.currency !== "PHP" ||
      !Number.isSafeInteger(item.amount) ||
      item.amount <= 0 ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity <= 0
    ) {
      throw new Error("Invalid checkout line item.");
    }

    checkoutCentavos += item.amount * item.quantity;
  }

  const expectedCentavos = Math.round(Number(tx.amount) * 100);

  if (
    !Number.isSafeInteger(checkoutCentavos) ||
    !Number.isSafeInteger(expectedCentavos) ||
    checkoutCentavos !== expectedCentavos
  ) {
    throw new Error("Payment amount mismatch.");
  }

  console.log("Verified sandbox deposit:", {
    transactionMatches: true,
    paymentSucceeded: true,
    paymentPaid: true,
    amountPHP: checkoutCentavos / 100,
    statusBefore: tx.status,
  });

  if (confirm !== "--confirm") {
    console.log(
      "DRY RUN ONLY. No wallet or database changes made."
    );
    return;
  }

  const { data, error } = await supabase.rpc(
    "reconcile_verified_sandbox_deposit",
    {
      p_transaction_id: tx.id,
      p_checkout_id: checkoutId,
      p_amount_centavos: checkoutCentavos,
    }
  );

  if (error) {
    throw new Error(
      `Database reconciliation failed: ${error.message}`
    );
  }

  console.log("Reconciliation result:", data);
}

main().catch((error) => {
  console.error("Reconciliation stopped:", error.message);
  process.exitCode = 1;
});
