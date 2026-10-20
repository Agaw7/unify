import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !service) return NextResponse.json({error:"Server configuration missing"},{status:500});
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({error:"Unauthorized"},{status:401});
  const authClient = createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:authError} = await authClient.auth.getUser(token);
  if (authError || !user) return NextResponse.json({error:"Unauthorized"},{status:401});
  const db = createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const [investments,wallet,claims] = await Promise.all([
    db.from("demo_investments").select("id,created_at,daily_income").eq("user_id",user.id).order("created_at",{ascending:false}),
    db.from("simulation_wallets").select("balance").eq("user_id",user.id).maybeSingle(),
    db.from("simulation_daily_claims").select("investment_id,claim_day").eq("user_id",user.id),
  ]);
  if (investments.error || wallet.error || claims.error) return NextResponse.json({error:investments.error?.message||wallet.error?.message||claims.error?.message},{status:500});
  const count = new Map<string,number>();
  for (const c of claims.data ?? []) count.set(c.investment_id,(count.get(c.investment_id)??0)+1);
  const now = Date.now();
  const items = (investments.data??[]).map(i=>{
    const start = new Date(i.created_at).getTime();
    const elapsed = Math.max(0,Math.min(365,Math.floor((now-start)/86400000)));
    const claimed = count.get(i.id)??0;
    return {id:i.id,purchasedAt:i.created_at,dailyAmount:i.daily_income,eligibleDays:elapsed,claimedDays:claimed,claimableDays:Math.max(0,elapsed-claimed),nextUnlockAt:elapsed>=365?null:new Date(start+(elapsed+1)*86400000).toISOString()};
  });
  return NextResponse.json({mode:"simulation_only",balance:wallet.data?.balance??0,investments:items},{headers:{"Cache-Control":"no-store"}});
}
