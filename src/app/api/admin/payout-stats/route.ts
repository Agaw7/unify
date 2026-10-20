
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !anonKey || !serviceKey) {
      return NextResponse.json(
        { error: "Missing server configuration." },
        { status: 500 }
      );
    }

    const authorization =
      request.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 }
      );
    }

    const authClient = createClient(url, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { data: auth, error: authError } =
      await authClient.auth.getUser(
        authorization.slice(7).trim()
      );

    if (authError || !auth.user) {
      return NextResponse.json(
        { error: "Invalid administrator session." },
        { status: 401 }
      );
    }

    const admin = createClient(url, serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { data: profile, error: profileError } =
      await admin
        .from("profiles")
        .select("role")
        .eq("id", auth.user.id)
        .single();

    if (profileError || profile?.role !== "admin") {
      return NextResponse.json(
        { error: "Administrator access required." },
        { status: 403 }
      );
    }

    // Read only records created by a trusted
    // payout verification workflow.
    let totalPaid = 0;
    let verifiedPayoutCount = 0;
    const pageSize = 500;

    for (let start = 0; ; start += pageSize) {
      const { data, error } = await admin
        .from("withdrawal_payout_confirmations")
        .select("amount,currency,provider_status")
        .eq("provider_status", "paid")
        .eq("currency", "PHP")
        .range(start, start + pageSize - 1);

      if (error) throw error;

      for (const payout of data ?? []) {
        totalPaid += Number(payout.amount);
        verifiedPayoutCount += 1;
      }

      if ((data ?? []).length < pageSize) break;
    }

    return NextResponse.json({
      currency: "PHP",
      totalWithdrawalsPaid: totalPaid,
      verifiedPayoutCount,
      source: "verified_payout_confirmations",
    });
  } catch (error) {
    console.error("Payout statistics error:", error);

    return NextResponse.json(
      { error: "Unable to load payout statistics." },
      { status: 500 }
    );
  }
}
