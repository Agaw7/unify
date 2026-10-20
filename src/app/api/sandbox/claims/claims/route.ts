import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
export const runtime = "nodejs";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function POST(req: NextRequest) {
  if (process.env.UNIFY_SANDBOX_CLAIMS_ENABLED !== "true" || !process.env.PAYMONGO_SECRET_KEY?.startsWith("sk_test_"))
    return NextResponse.json({error:"Sandbox claim mode is disabled"},{status:403});
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,service=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url||!anon||!service) return NextResponse.json({error:"Server configuration missing"},{status:500});
  const token=req.headers.get("authorization")?.replace(/^Bearer\s+/i,"");
  if (!token) return NextResponse.json({error:"Unauthorized"},{status:401});
  const authClient=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:authError}=await authClient.auth.getUser(token);
  if (authError||!user) return NextResponse.json({error:"Unauthorized"},{status:401});
  let body:unknown;
  try {body=await req.json();} catch {return NextResponse.json({error:"Invalid JSON"},{status:400});}
  const id=body&&typeof body==="object"&&"investmentId" in body?(body as {investmentId:unknown}).investmentId:null;
  if(typeof id!=="string"||!uuid.test(id)) return NextResponse.json({error:"Invalid investment ID"},{status:400});
  const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await db.rpc("claim_simulation_days",{p_user_id:user.id,p_investment_id:id});
  if(error){console.error("Simulation claim error",error);return NextResponse.json({error:"Unable to process simulation claim"},{status:409});}
  return NextResponse.json({mode:"simulation_only",...data},{headers:{"Cache-Control":"no-store"}});
}
