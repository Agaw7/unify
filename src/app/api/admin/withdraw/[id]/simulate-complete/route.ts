import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    if (process.env.UNIFY_SANDBOX_PAYOUTS_ENABLED !== "true" ||
        !process.env.PAYMONGO_SECRET_KEY?.startsWith("sk_test_")) {
      return NextResponse.json({ error: "Sandbox simulation is disabled." }, { status: 403 });
    }
    const { id } = await context.params;
    if (!uuidPattern.test(id)) {
      return NextResponse.json({ error: "Invalid withdrawal ID." }, { status: 400 });
    }
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anonKey || !serviceKey) {
      return NextResponse.json({ error: "Missing server configuration." }, { status: 500 });
    }
    const bearer = request.headers.get("authorization");
    if (!bearer?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
    const authClient = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: auth, error: authError } = await authClient.auth.getUser(bearer.slice(7).trim());
    if (authError || !auth.user) {
      return NextResponse.json({ error: "Invalid session." }, { status: 401 });
    }
    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: profile, error: profileError } = await admin.from("profiles")
      .select("role").eq("id", auth.user.id).maybeSingle();
    if (profileError || profile?.role !== "admin") {
      return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
    }
    const { data: result, error } = await admin.rpc("complete_sandbox_withdrawal", {
      p_request_id: id,
      p_admin_id: auth.user.id,
    });
    if (error) {
      console.error("Sandbox withdrawal completion:", error.code, error.message);
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ success: true, result, simulated: true,
      message: result === "already_simulated_paid"
        ? "Already marked as simulated paid. No real transfer occurred."
        : "Simulated payout completed. No real GCash/Maya transfer occurred."
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Sandbox payout endpoint error:", error);
    return NextResponse.json({ error: "Unable to complete simulated payout." }, { status: 500 });
  }
}
