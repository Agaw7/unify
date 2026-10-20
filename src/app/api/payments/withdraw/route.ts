
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getClients() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anonKey || !serviceKey) {
    throw new Error("Missing Supabase server configuration");
  }

  const authClient = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const admin = createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return { authClient, admin };
}

async function authenticate(request: NextRequest) {
  const header = request.headers.get("authorization");

  if (!header?.startsWith("Bearer ")) {
    return null;
  }

  const token = header.slice(7).trim();

  if (!token) return null;

  const { authClient, admin } = getClients();

  const { data, error } =
    await authClient.auth.getUser(token);

  if (error || !data.user) return null;

  return { user: data.user, admin };
}

// POST: Reserve a sandbox withdrawal.
export async function POST(request: NextRequest) {
  try {
    const session = await authenticate(request);

    if (!session) {
      return NextResponse.json(
        { error: "Please log in first." },
        { status: 401 }
      );
    }

    const body = await request.json();

    const amount = body?.amount;
    const paymentAccountId = body?.paymentAccountId;
    const idempotencyKey = body?.idempotencyKey;

    if (
      typeof amount !== "number" ||
      !Number.isFinite(amount) ||
      amount < 200 ||
      amount > 50000 ||
      Math.round(amount * 100) !== amount * 100
    ) {
      return NextResponse.json(
        { error: "Enter a valid amount from ₱200 to ₱50,000." },
        { status: 400 }
      );
    }

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (
      typeof paymentAccountId !== "string" ||
      !uuidPattern.test(paymentAccountId) ||
      typeof idempotencyKey !== "string" ||
      !uuidPattern.test(idempotencyKey)
    ) {
      return NextResponse.json(
        { error: "Invalid withdrawal request." },
        { status: 400 }
      );
    }

    const { data, error } = await session.admin.rpc(
      "reserve_withdrawal",
      {
        p_user_id: session.user.id,
        p_amount: amount,
        p_payment_account_id: paymentAccountId,
        p_idempotency_key: idempotencyKey,
      }
    );

    if (error) {
      console.error("Withdrawal reservation error:", {
        code: error.code,
        message: error.message,
      });

      if (
        error.message.includes("Insufficient available balance")
      ) {
        return NextResponse.json(
          { error: "Insufficient available balance." },
          { status: 400 }
        );
      }

      if (
        error.message.includes("payment account not found") ||
        error.message.includes("payment destination")
      ) {
        return NextResponse.json(
          { error: "Invalid saved payment account." },
          { status: 400 }
        );
      }

      return NextResponse.json(
        { error: "Unable to reserve withdrawal." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      requestId: data,
      status: "reserved",
      message: "Sandbox withdrawal reserved for review.",
    });
  } catch (error) {
    console.error("UNIFY withdrawal API error:", error);

    return NextResponse.json(
      { error: "Unable to process withdrawal request." },
      { status: 500 }
    );
  }
}

// GET: Load the user's withdrawal history.
export async function GET(request: NextRequest) {
  try {
    const session = await authenticate(request);

    if (!session) {
      return NextResponse.json(
        { error: "Please log in first." },
        { status: 401 }
      );
    }

    const { data, error } = await session.admin
      .from("withdrawal_requests")
      .select(
        "id, amount, currency, payment_method, destination_reference, status, created_at"
      )
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("Withdrawal history error:", error.message);

      return NextResponse.json(
        { error: "Unable to load withdrawal history." },
        { status: 500 }
      );
    }

    const history = (data ?? []).map((item) => ({
      id: item.id,
      amount: Number(item.amount),
      currency: item.currency,
      paymentMethod: item.payment_method,
      destination:
        "*******" + String(item.destination_reference).slice(-4),
      status: item.status,
      createdAt: item.created_at,
    }));

    return NextResponse.json({ history });
  } catch (error) {
    console.error("UNIFY withdrawal history error:", error);

    return NextResponse.json(
      { error: "Unable to load withdrawal history." },
      { status: 500 }
    );
  }
}
