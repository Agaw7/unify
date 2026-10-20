"use client";
import {useCallback,useEffect,useState} from "react";
import {supabase} from "@/lib/supabase";

type Investment={id:string;purchasedAt:string;dailyAmount:number;eligibleDays:number;claimedDays:number;claimableDays:number;nextUnlockAt:string|null};
type ClaimsData={mode:string;balance:number;investments:Investment[]};
const php=(n:number)=>new Intl.NumberFormat("en-PH",{style:"currency",currency:"PHP"}).format(n);
export default function SandboxClaimsPage(){
  const [data,setData]=useState<ClaimsData|null>(null);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState<string|null>(null);
  const load=useCallback(async()=>{
    try{
      const {data:session}=await supabase.auth.getSession();
      if(!session.session)throw new Error("Log in to view simulated claims");
      const res=await fetch("/api/sandbox/claims",{headers:{Authorization:`Bearer ${session.session.access_token}`},cache:"no-store"});
      const json=await res.json();if(!res.ok)throw new Error(json.error||"Unable to load claims");
      setData(json);setError("");
    }catch(e){setError(e instanceof Error?e.message:"Unable to load claims");}
  },[]);
  useEffect(()=>{void load();},[load]);
  async function claim(investmentId:string){
    setBusy(investmentId);setError("");
    try{
      const {data:session}=await supabase.auth.getSession();
      if(!session.session)throw new Error("Please log in");
      const res=await fetch("/api/sandbox/claims/claim",{method:"POST",headers:{Authorization:`Bearer ${session.session.access_token}`,"Content-Type":"application/json"},body:JSON.stringify({investmentId})});
      const json=await res.json();if(!res.ok)throw new Error(json.error||"Claim failed");
      await load();
    }catch(e){setError(e instanceof Error?e.message:"Claim failed");}
    finally{setBusy(null);}
  }
  return <main style={{padding:24,maxWidth:760,margin:"auto"}}>
    <h1>Simulated Daily Claims</h1>
    <p>Training/demo credits only. Not cash, investment returns, or withdrawable money.</p>
    <h2>Simulation wallet: {data?php(Number(data.balance)):"Loading..."}</h2>
    {error&&<p role="alert" style={{color:"#ef4444"}}>{error}</p>}
    {data?.investments.map(i=><section key={i.id} style={{border:"1px solid #64748b",padding:16,borderRadius:12,marginTop:12}}>
      <p>Investment: {i.id}</p>
      <p>Purchased: {new Date(i.purchasedAt).toLocaleString("en-PH",{timeZone:"Asia/Manila"})}</p>
      <p>Illustrative daily credit: {php(Number(i.dailyAmount))}</p>
      <p>Claimed: {i.claimedDays}/365 days · Available: {i.claimableDays} days ({php(i.claimableDays*Number(i.dailyAmount))})</p>
      <p>Next 24-hour unlock: {i.nextUnlockAt?new Date(i.nextUnlockAt).toLocaleString("en-PH",{timeZone:"Asia/Manila"}):"Ended"}</p>
      <button disabled={i.claimableDays===0||busy!==null} onClick={()=>void claim(i.id)}>{busy===i.id?"Claiming...":"Claim available simulated credits"}</button>
    </section>)}
  </main>;
}
