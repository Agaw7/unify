
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    // STEP 1: Load environment variables
    const requiredConfig = {
      NEXT_PUBLIC_SUPABASE_URL:
        process.env.NEXT_PUBLIC_SUPABASE_URL,

      NEXT_PUBLIC_SUPABASE_ANON_KEY:
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,

      SUPABASE_SERVICE_ROLE_KEY:
        process.env.SUPABASE_SERVICE_ROLE_KEY,

      PAYMONGO_SECRET_KEY:
        process.env.PAYMONGO_SECRET_KEY,

      NEXT_PUBLIC_APP_URL:
        process.env.NEXT_PUBLIC_APP_URL,
    };

    // STEP 2: Identify missing environment variables
    const missingVariables = Object.entries(requiredConfig)
      .filter(([, value]) => !value?.trim())
      .map(([name]) => name);

    if (missingVariables.length > 0) {
      console.error(
        "UNIFY missing environment variables:",
        missingVariables.join(", ")
      );

      return NextResponse.json(
        {
          error:
            "Missing server configuration. Check your Next.js terminal.",
        },
        { status: 500 }
      );
    }

    // STEP 3: Validate PayMongo test mode
    const paymongoKey =
      requiredConfig.PAYMONGO_SECRET_KEY;

    if (!paymongoKey?.startsWith("sk_test_")) {
      return NextResponse.json(
        {
          error:
            "Invalid PayMongo configuration. A test secret key is required.",
        },
        { status: 500 }
      );
    }

    // STEP 4: Read request body
    const body = await request.json();

    const amount = Number(body?.amount);
    const paymentMethod = body?.paymentMethod;

    // STEP 5: Validate deposit amount
    if (
      !Number.isFinite(amount) ||
      amount < 200 ||
      amount > 50000 ||
      Math.abs(
        amount * 100 - Math.round(amount * 100)
      ) > 0.000001
    ) {
      return NextResponse.json(
        {
          error:
            "Deposit amount must be between ₱200 and ₱50,000.",
        },
        { status: 400 }
      );
    }

    // STEP 6: Validate payment method
    if (
      paymentMethod !== "gcash" &&
      paymentMethod !== "maya"
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid payment method. Choose GCash or Maya.",
        },
        { status: 400 }
      );
    }

    // STEP 7: Temporary configuration test
    // This does NOT create a PayMongo checkout
    // or update any Supabase wallet balance.
    return NextResponse.json({
      success: true,
      message:
        "UNIFY deposit API configuration is working.",
      received: {
        amount,
        paymentMethod,
      },
      paymongoMode: "test",
      checkoutCreated: false,
    });

  } catch (error) {
    console.error("UNIFY deposit API error:", error);

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "Invalid JSON request body." },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Internal deposit API error." },
      { status: 500 }
    );
  }
}
