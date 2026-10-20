
require("dotenv").config({ path: ".env.local" });

const checkoutId = process.argv[2];
const key = process.env.PAYMONGO_SECRET_KEY;

if (!checkoutId || !/^cs_[A-Za-z0-9]+$/.test(checkoutId)) {
  console.error("Enter a valid PayMongo checkout ID.");
  process.exit(1);
}

if (!key || !key.startsWith("sk_test_")) {
  console.error("PayMongo test key is missing.");
  process.exit(1);
}

async function checkCheckout() {
const response = await fetch(
  `https://api.paymongo.com/v1/checkout_sessions/${encodeURIComponent(checkoutId)}`,
    {
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(`${key}:`).toString("base64"),
        Accept: "application/json",
      },
    }
  );

  const result = await response.json();

  if (!response.ok) {
    console.error("PayMongo API status:", response.status);
    return;
  }

  const attributes = result?.data?.attributes || {};

  console.log("Checkout verification diagnostics:", {
    idMatches: result?.data?.id === checkoutId,
    checkoutStatus: attributes.status ?? null,
    referenceIsUUID:
      typeof attributes.reference_number === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        attributes.reference_number
      ),
    paymentIntentStatus:
      attributes.payment_intent?.attributes?.status ?? null,
    paymentStatuses: Array.isArray(attributes.payments)
      ? attributes.payments.map(
          (payment) =>
            payment.attributes?.status ??
            payment.status ??
            null
        )
      : null,
      

lineItemCount: Array.isArray(attributes.line_items)
  ? attributes.line_items.length
  : null,

lineItems: Array.isArray(attributes.line_items)
  ? attributes.line_items.map((item) => ({
      amount: item.amount,
      quantity: item.quantity,
      currency: item.currency,
    }))
  : [],

referenceMatchesTransaction:
  attributes.reference_number ===
  "e0945bf5-2641-463b-8101-2d956e86b63a",
  });
}


checkCheckout().catch((error) => {
  console.error("Checkout lookup failed:", error.message);
});
