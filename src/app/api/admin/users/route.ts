import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) {
    return NextResponse.json({ error: "Supabase server configuration is missing." }, { status: 500 });
  }

  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "");
  if (!match) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const authClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await authClient.auth.getUser(match[1]);
  if (authError || !authData.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const adminClient = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: profile, error: profileError } = await adminClient.from("profiles").select("role").eq("id", authData.user.id).maybeSingle();
  if (profileError) return NextResponse.json({ error: "Unable to verify admin permissions." }, { status: 500 });
  if (profile?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data: profiles, error: listError } = await adminClient.from("profiles")
    .select("id, role, invite_code, created_at").order("created_at", { ascending: false }).limit(500);
  if (listError) return NextResponse.json({ error: "Unable to retrieve members." }, { status: 500 });

  const members = await Promise.all((profiles ?? []).map(async (p) => {
    const { data } = await adminClient.auth.admin.getUserById(p.id);
    return { id: p.id, phone: data.user?.phone ?? null, role: p.role ?? "user", invite_code: p.invite_code ?? null, created_at: p.created_at ?? null };
  }));

  return NextResponse.json({ members }, { headers: { "Cache-Control": "no-store" } });
}
