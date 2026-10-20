
import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export const runtime = "nodejs";

type PaymentMethod = "gcash" | "maya";

export async function POST(request: NextRequest) {
  let transactionId: string | null = null;

  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const paymongoKey = process.env.PAYMONGO_SECRET_KEY;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;

    if (!url || !anonKey || !serviceKey ||
        !paymongoKey || !appUrl) {
      return NextResponse.json(
        { error: "Missing server configuration." },
        { status: 500 }
      );
    }

    if (!paymongoKey.startsWith("sk_test_")) {
      return NextResponse.json(
        { error: "PayMongo test key required." },
        { status: 500 }
      );
    }

    const cookieStore = await cookies();

    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(values) {
          try {
            values.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Cookies may be managed by middleware.
          }
        },
      },
    });

// Read the user's access token
const authorization = request.headers.get("authorization");

if (!authorization?.startsWith("Bearer ")) {
  return NextResponse.json(
    { error: "Please log in first." },
    { status: 401 }
  );
}

const accessToken = authorization.slice(7).trim();

// Verify the token with Supabase Auth
const { data: auth, error: authError } =
  await supabase.auth.getUser(accessToken);

if (authError || !auth.user) {
  return NextResponse.json(
    { error: "Session expired. Please log in again." },
    { status: 401 }
  );
}

    const body = await request.json();
    const amount = Number(body.amount);
    const paymentMethod: PaymentMethod = body.paymentMethod;

    if (
      !Number.isFinite(amount) ||
      amount < 200 ||
      amount > 50000 ||
      Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001
    ) {
      return NextResponse.json(
        { error: "Deposit must be ₱200–₱50,000." },
        { status: 400 }
      );
    }

    if (paymentMethod !== "gcash" &&
        paymentMethod !== "maya") {
      return NextResponse.json(
        { error: "Invalid payment method." },
        { status: 400 }
      );
    }

    const admin = createAdminClient(url, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { data: tx, error: txError } = await admin
      .from("payment_transactions")
      .insert({
        user_id: auth.user.id,
        transaction_type: "deposit",
        amount,
        currency: "PHP",
        status: "pending",
        provider: "paymongo",
        payment_method: paymentMethod,
      })
      .select("id")
      .single();

    if (txError || !tx) {
      console.error("UNIFY transaction error:", txError);
      return NextResponse.json(
        { error: "Unable to create pending transaction." },
        { status: 500 }
      );
    }

    transactionId = tx.id;

    const baseUrl = new URL(appUrl);
    const centavos = Math.round(amount * 100);

    // PayMongo calls Maya "paymaya" in the API.
    const paymongoMethod =
      paymentMethod === "maya" ? "paymaya" : "gcash";

    const paymongoResponse = await fetch(
      "https://api.paymongo.com/v2/checkout_sessions",
      {
        method: "POST",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(`${paymongoKey}:`).toString("base64"),
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          data: {
            attributes: {
              line_items: [
                {
                  name: "UNIFY Sandbox Wallet Credit",
                  description: "Test wallet credit",
                  amount: centavos,
                  currency: "PHP",
                  quantity: 1,
                },
              ],
              payment_method_types: [paymongoMethod],
              success_url: new URL(
                "/deposit?status=success",
                baseUrl
              ).toString(),
              cancel_url: new URL(
                "/deposit?status=cancelled",
                baseUrl
              ).toString(),
              reference_number: tx.id,
              description: "UNIFY sandbox payment",
              metadata: {
                transaction_id: tx.id,
                user_id: auth.user.id,
              },
            },
          },
        }),
        cache: "no-store",
      }
    );

    const paymongoResult = await paymongoResponse.json();

    if (!paymongoResponse.ok) {
      console.error(
        "PayMongo checkout error:",
        paymongoResponse.status,
        paymongoResult
      );

      await admin
        .from("payment_transactions")
        .update({ status: "failed" })
        .eq("id", tx.id)
        .eq("status", "pending");

      return NextResponse.json(
        {
          error:
            paymongoResult.errors?.[0]?.detail ||
            "PayMongo checkout creation failed.",
        },
        { status: 502 }
      );
    }

    const checkoutId = paymongoResult.data?.id;
    const checkoutUrl =
      paymongoResult.data?.attributes?.checkout_url;

    if (!checkoutId || !checkoutUrl) {
      return NextResponse.json(
        { error: "Invalid PayMongo checkout response." },
        { status: 502 }
      );
    }

const { data: updatedTx, error: updateError } = await admin
  .from("payment_transactions")
  .update({ provider_reference: checkoutId })
  .eq("id", tx.id)
  .eq("status", "pending")
  .select("id, provider_reference")
  .single();

if (updateError || !updatedTx) {
  console.error("Unable to save checkout ID:", updateError);

  return NextResponse.json(
    { error: "Unable to save checkout session." },
    { status: 500 }
  );
}

console.log("PayMongo checkout linked to UNIFY transaction", {
  checkoutLinked: updatedTx.provider_reference === checkoutId,
});

    if (updateError) {
      console.error("Unable to save checkout ID:", updateError);
      return NextResponse.json(
        { error: "Unable to save checkout session." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      transactionId: tx.id,
      checkoutUrl,
    });
  } catch (error) {
    console.error("UNIFY deposit error:", error);

    return NextResponse.json(
      { error: "Unable to initialize PayMongo checkout." },
      { status: 500 }
    );
  }
}
