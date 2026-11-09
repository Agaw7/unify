'use client';

import { productDisplayName, productDisplayImage, isCatalogProduct } from '@/lib/product-presentation';
import Image from 'next/image';
import { PackageOpen, RefreshCw, Layers } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { moneyRequest } from '@/lib/money-client';
type Product={id:string;name:string;price:number;daily_amount:number;duration_days:number;funded:boolean};
type Contract={id:string;product_id:string;idempotency_key:string;name:string;price:number;daily_amount:number;duration_days:number;claimed_days:number;created_at:string;acquisition:string};
type State={enabled:boolean;eligible:boolean;wallet:{available:number;deposit_available:number;currency:string};products:Product[];investments:Contract[]};
const php=(cents:number)=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(cents)/100);
export default function LiveInvestments({selectedProductId,view="portfolio",onPurchased}:{selectedProductId?:string;view?:"checkout"|"portfolio"|"market";onPurchased?:()=>void}){
 const [data,setData]=useState<State|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[accepted,setAccepted]=useState(false),[now,setNow]=useState(0),[marketSelection,setMarketSelection]=useState<string|null>(null);const lock=useRef(false);
 const [refreshing,setRefreshing]=useState(false);
 const loading=useRef(false);
 const load=useCallback(async()=>{
  if(loading.current)return;
  loading.current=true;setRefreshing(true);
  try{
  const result:State=await moneyRequest(view==='portfolio'?'/api/investments?view=portfolio':'/api/investments');let recovered=false;
  for(const investment of result.investments){const storageKey=`unify-live-plan:${investment.product_id}`;if(investment.acquisition==='purchase' && sessionStorage.getItem(storageKey)===investment.idempotency_key){sessionStorage.removeItem(storageKey);recovered=true;}}
  setData(result);setNow(Date.now());
  if(recovered){setAccepted(false);setError('');setNotice('Your earlier purchase is confirmed in the portfolio. Review it before buying another plan.');}
 }catch(e){setError(e instanceof Error?e.message:'Unable to load plans');}
 finally{loading.current=false;setRefreshing(false);}
 },[view]);
 useEffect(()=>{void load();const timer=setInterval(()=>setNow(Date.now()),30000);const refresh=()=>void load();window.addEventListener('focus',refresh);return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);};},[load]);
 useEffect(()=>{setAccepted(false);},[selectedProductId,marketSelection]);
 async function purchase(id:string){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');
  try{
    const product=data?.products.find(p=>p.id===id);if(!product || !accepted)throw new Error('Select a product and accept its displayed terms.');
    const storageKey=`unify-live-plan:${id}`;let key=sessionStorage.getItem(storageKey);if(!key){key=crypto.randomUUID();sessionStorage.setItem(storageKey,key);}
    await moneyRequest('/api/investments',{action:'purchase',productId:id,key,accepted,expectedPrice:product.price,expectedDaily:product.daily_amount,expectedDuration:product.duration_days});sessionStorage.removeItem(storageKey);setNotice('Live product purchased. Deposit Balance was used first, then available PHP funds. Daily rewards are reserved from the business budget.');setAccepted(false);if(view==='market')setMarketSelection(null);onPurchased?.();
   await load();
  }catch(e){setError(e instanceof Error?e.message:'Unable to complete request. Refresh before retrying.');await load();}
  finally{lock.current=false;setBusy(false);}
 }
 const spendable=data?Number(data.wallet.deposit_available)+Number(data.wallet.available):0;
 const effectiveProductId=selectedProductId ?? (view==='market'?marketSelection ?? undefined:undefined);
 const shownProducts=data?.products.filter(p=>isCatalogProduct(p.name) && (!effectiveProductId || p.id===effectiveProductId)) ?? [];
 const isCheckout=view==='checkout' || (view==='market' && marketSelection!==null);
 return <div className={view==='portfolio'?'live-assets space-y-5 text-white':'space-y-5 text-[#48204f]'}>{view!=='checkout' && <header className="assets-heading"><div><span className="assets-eyebrow"><Layers size={15}/> {view==='market'?'AUREVIA MARKET':'YOUR PORTFOLIO'}</span><h2>{view==='market'?'Market':'My Tier'}</h2><p>{view==='market'?'Browse the current product catalog and review plan terms.':'Your purchased products and daily rewards, in one place.'}</p></div><button type="button" disabled={busy || refreshing} aria-busy={refreshing} className="assets-refresh" aria-label={view==='market'?'Refresh market':'Refresh my tiers'} onClick={()=>{setError('');void load();}}><RefreshCw size={16}/><span>{refreshing ? 'Refreshing…' : 'Refresh'}</span></button></header>}
 {view==='market' && marketSelection && <button type="button" className="text-sm font-semibold text-[#54265e] underline" onClick={()=>{setMarketSelection(null);setAccepted(false);}}>← Back to Market</button>}
 {error && <p role="alert" className={`rounded-xl p-4 ${view==='market'?'border border-red-200 bg-red-50 text-red-800':'bg-red-950 text-red-200'}`}>{error}</p>}{notice && <p role="status" className={`rounded-xl p-4 ${view==='market'?'border border-cyan-200 bg-cyan-50 text-cyan-800':'bg-cyan-950 text-cyan-100'}`}>{notice}</p>}
 {data && !data.enabled && <p role="status" className={view==='market'?'text-amber-800':'text-amber-200'}>Live purchases are currently disabled.</p>}
 {data && !data.eligible && <p role="status" className={view==='market'?'text-amber-800':'text-amber-200'}>This account has a financial restriction. Contact support.</p>}
 {isCheckout && <section className="space-y-3 rounded-xl border border-[#eadff0] bg-white/80 p-5"><h2 className="text-xl font-semibold">Confirm purchase</h2><p className="text-sm text-[#775d80]">Rewards become eligible after each full 24 hours and are credited automatically on the next scheduled run, for the duration shown on the plan. The plan price is not automatically returned at maturity. New plans require the full daily rewards allocation to be funded before purchase; paid deposit holds cannot be spent.</p><label className="flex items-start gap-3 text-sm text-[#54265e]"><input className="mt-1" type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)} disabled={busy}/><span>I have read these terms and authorize the displayed purchase price to be deducted from my PHP wallet when I confirm a purchase.</span></label></section>}
 {!data?<p className={view==='market'?'text-[#775d80]':'text-white'}>Loading plans…</p>:<>
  {isCheckout && shownProducts.length===0 && <p role="alert">Product unavailable. Return to Market to choose another product.</p>}
  {view==='market' && !marketSelection && <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{shownProducts.map(p=><article key={p.id} className="space-y-3 rounded-2xl border border-[#eadff0] bg-white/80 p-4 shadow-sm">
   <Image src={productDisplayImage(p.name)} alt={productDisplayName(p.name)} width={640} height={480} className="aspect-[4/3] w-full rounded-xl bg-[#f7f0fa] object-contain"/>
   <h3 className="text-lg font-bold text-[#54265e]">{productDisplayName(p.name)}</h3><p className="text-xl font-bold text-[#48204f]">{php(p.price)}</p>
   <p className="text-sm text-[#775d80]">{php(p.daily_amount)} illustrative daily reward · {p.duration_days} days</p>
   <button type="button" className="w-full rounded-xl bg-[#54265e] p-3 font-semibold text-white" onClick={()=>setMarketSelection(p.id)}>Review plan</button>
  </article>)}
  {shownProducts.length===0 && <p className="rounded-2xl border border-[#eadff0] bg-white/80 p-5 text-[#775d80]">No catalog products are available.</p>}</section>}
  {isCheckout && <section className="grid gap-4">{shownProducts.map(p=><article key={p.id} className="space-y-3 rounded-xl border border-[#eadff0] bg-white/80 p-5">
   <Image src={productDisplayImage(p.name)} alt={productDisplayName(p.name)} width={640} height={480} className="aspect-[4/3] w-full rounded-lg bg-white object-contain"/>
   <h2 className="text-xl font-semibold text-[#54265e]">{productDisplayName(p.name)}</h2><p className="text-2xl font-bold text-[#48204f]">{php(p.price)}</p>
   <p className="text-[#775d80]">Daily reward: <strong className="text-emerald-700">{php(p.daily_amount)}</strong></p><p className="text-sm text-[#775d80]">{p.duration_days} days · Total rewards {php(p.daily_amount*p.duration_days)}</p>
   {!p.funded && <p className="text-sm text-amber-800">Awaiting business funding. Required rewards reserve: {php(p.daily_amount*p.duration_days)}.</p>}
   {spendable<p.price && <p className="text-sm text-amber-800">Available purchase funds {php(spendable)} are below the price of {php(p.price)}.</p>}
   <button className="w-full rounded-lg bg-[#54265e] p-3 font-semibold text-white disabled:opacity-50" disabled={busy || !accepted || !p.funded || !data.enabled || !data.eligible || spendable<p.price} onClick={()=>{if(window.confirm(`Purchase ${productDisplayName(p.name)} for ${php(p.price)}? Deposit Balance is used first, then available PHP funds. The price is not automatically returned.`))void purchase(p.id);}}>{data.enabled?'Buy product':'Purchases unavailable'} · {php(p.price)}</button>
  </article>)}</section>}
 {view==='portfolio' && <section id="portfolio" className="space-y-4">{data.investments.length===0 && <div className="assets-empty"><div className="assets-empty-icon"><PackageOpen size={34} strokeWidth={1.5}/></div><h3>No products yet</h3><p>Plans you purchase from Market will appear here.<br/>Track automatic daily rewards from My Tier.</p><span className="assets-cycle">24-hour reward cycle</span></div>}{data.investments.map(inv => {
   const nextDay = inv.claimed_days + 1;
   const nextCreditAt = Date.parse(inv.created_at) + nextDay * 86400000;
   const completed = nextDay > inv.duration_days;
   return <article key={inv.id} className="space-y-3 rounded-xl border border-slate-700 bg-[#10243b] p-5">
     <div className="flex flex-wrap justify-between gap-3">
       <h3 className="text-xl font-semibold">{productDisplayName(inv.name)}</h3>
       <span className="text-cyan-200">{inv.acquisition === 'free_plan' ? 'Free welcome plan' : php(inv.price)}</span>
     </div>
     <p>Daily reward {php(inv.daily_amount)} · Credited {inv.claimed_days}/{inv.duration_days} days</p>
     <p className="text-sm text-slate-300">Rewards are credited automatically to Wallet Available Balance.</p>
     <p className="text-sm text-slate-300">{completed ? 'All rewards credited' : now >= nextCreditAt ? 'Eligible · awaiting scheduled credit' : 'Next reward eligible ' + new Date(nextCreditAt).toLocaleString()}</p>
   </article>;
 })}</section>}</>}
 <style jsx>{`
 .live-assets{width:100%;max-width:1120px;margin:0 auto;padding:12px 0 32px;min-width:0}
 .assets-heading{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:28px}
 .assets-eyebrow{display:flex;align-items:center;gap:8px;color:#5edbf4;font-size:11px;font-weight:700;letter-spacing:1.6px}
 .assets-heading h2{margin:10px 0 8px;font-size:30px;line-height:1.2;font-weight:700;color:#f3f8ff}
 .assets-heading p{margin:0;color:#9fb3ce;font-size:14px;line-height:1.6}
 .assets-refresh{display:inline-flex;align-items:center;justify-content:center;gap:8px;flex-shrink:0;padding:11px 15px;border:1px solid #294362;border-radius:12px;background:#12243a;color:#85e6fa;font-size:13px;cursor:pointer;min-height:44px}
 .assets-refresh:hover{background:#18334e}.assets-refresh:focus-visible{outline:2px solid #22d3ee;outline-offset:3px}
 .assets-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;min-height:330px;padding:40px 20px;border:1px solid #253d59;border-radius:22px;background:linear-gradient(145deg,#12263c,#0d1b2d);box-shadow:0 14px 40px #00000016}
 .assets-empty-icon{display:grid;place-items:center;width:76px;height:76px;margin-bottom:22px;border-radius:23px;background:#05bfd916;border:1px solid #22d3ee35;color:#50d9ed}
 .assets-empty h3{margin:0 0 12px;font-size:21px;font-weight:600;color:#f1f7ff}
 .assets-empty p{margin:0;max-width:420px;color:#a7bad2;font-size:14px;line-height:1.8}
 .assets-cycle{margin-top:24px;padding:7px 12px;border-radius:20px;background:#183148;color:#98c3dd;font-size:11px;letter-spacing:.2px}
 @media(max-width:600px){.live-assets{padding-top:8px}.assets-heading{align-items:flex-start;gap:12px;margin-bottom:22px}.assets-heading h2{font-size:26px}.assets-heading p{max-width:230px;font-size:13px}.assets-refresh{padding:10px}.assets-refresh span{display:none}.assets-empty{min-height:320px;padding:32px 18px;border-radius:18px}.assets-empty p{font-size:13px}}
 `}</style></div>;
}
