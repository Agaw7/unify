
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export async function handleSandboxTransfer(
  request: NextRequest,
  type: "deposit" | "withdraw"
) {
  try {
    const authorization = request.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Please log in first." },
        { status: 401 }
      );
    }

    const token = authorization.slice(7).trim();

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    if (!url || !key) {
      return NextResponse.json(
        { error: "Supabase is not configured." },
        { status: 500 }
      );
    }

    const client = createClient(url, key, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { data: authData, error: authError } =
      await client.auth.getUser(token);

    if (authError || !authData.user) {
      return NextResponse.json(
        { error: "Invalid or expired session." },
        { status: 401 }
      );
    }

    const body = await request.json();
    const raw = body?.amount;

    // Accept decimal peso amounts with up to 2 decimal places.
    if (
      typeof raw !== "string" ||
      !/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(raw)
    ) {
      return NextResponse.json(
        { error: "Enter a valid amount up to ₱999,999.99." },
        { status: 400 }
      );
    }

    const [pesos, centavos = ""] = raw.split(".");
    const amountCentavos =
      Number(pesos) * 100 +
      Number(centavos.padEnd(2, "0"));

    if (amountCentavos <= 0) {
      return NextResponse.json(
        { error: "Amount must be greater than zero." },
        { status: 400 }
      );
    }

    const { data, error } = await client.rpc(
      "unify_sandbox_transfer",
      {
        p_type: type,
        p_amount_centavos: amountCentavos,
      }
    );

    if (error) {
      const message =
        error.message.includes("Insufficient sandbox balance")
          ? "Insufficient sandbox balance."
          : "Sandbox transaction failed.";

      return NextResponse.json(
        { error: message },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      mode: "sandbox",
      transaction: data?.[0] ?? null,
    });
  } catch {
    return NextResponse.json(
      { error: "Invalid request." },
      { status: 400 }
    );
  }
}
