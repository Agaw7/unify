
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !anonKey || !serviceKey) {
      return NextResponse.json(
        { error: "Server configuration missing" },
        { status: 500 }
      );
    }

    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: () => {},
      },
    });

    const { data, error: authError } =
      await supabase.auth.getUser();

    if (authError || !data.user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();

    const {
      amount,
      paymentMethod,
      destination,
      idempotencyKey,
    } = body;

    if (
      typeof amount !== "number" ||
      !Number.isFinite(amount) ||
      amount < 200 ||
      amount > 50000 ||
      Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001 ||
      !["gcash", "maya"].includes(paymentMethod) ||
      typeof destination !== "string" ||
      !/^09[0-9]{9}$/.test(destination) ||
      typeof idempotencyKey !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idempotencyKey)
    ) {
      return NextResponse.json(
        { error: "Invalid withdrawal details" },
        { status: 400 }
      );
    }

    const admin = createClient(url, serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { data: withdrawalId, error } =
      await admin.rpc("reserve_withdrawal", {
        p_user_id: data.user.id,
        p_amount: amount,
        p_payment_method: paymentMethod,
        p_destination: destination,
        p_idempotency_key: idempotencyKey,
      });

    if (error) {
      console.error("Withdrawal reservation error:", {
        code: error.code,
        message: error.message,
      });

      return NextResponse.json(
        { error: "Withdrawal could not be reserved. Check your balance and request details." },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      withdrawalId,
      status: "reserved",
      message: "Funds reserved. No payout has been sent.",
    });
  } catch (error) {
    console.error("UNIFY withdrawal API error:", error);

    return NextResponse.json(
      { error: "Unable to process withdrawal request" },
      { status: 500 }
    );
  }
}
