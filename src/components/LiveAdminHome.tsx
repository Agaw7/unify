'use client';
import { formatPhp } from '@/lib/format-php';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { moneyRequest } from '@/lib/money-client';

type Summary={members:number;deposits:number;paid:number;pending:number;depositCount:number};
const php=(cents:number)=>formatPhp(cents/100);
export default function LiveAdminHome(){
  const [data,setData]=useState<Summary|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const load=useCallback(async()=>{setBusy(true);setError('');try{setData(await moneyRequest('/api/admin/live-summary'));}catch(e){setError(e instanceof Error?e.message:'Unable to load administration');}finally{setBusy(false);}},[]);
  useEffect(()=>{void load();},[load]);
  return <main className="min-h-screen bg-[#0b1320] px-4 py-6 text-white sm:px-8"><div className="mx-auto max-w-5xl space-y-6"><header><Link href="/dashboard" className="text-cyan-300">← Dashboard</Link><h1 className="mt-4 text-3xl font-semibold">AROMEVA Administration</h1><p className="mt-2 text-slate-300">PHP payments, member accounts, and withdrawal operations.</p></header>{error && <p role="alert" className="rounded-xl bg-red-950 p-4 text-red-200">{error}</p>}<button disabled={busy} onClick={()=>void load()} className="rounded-lg bg-cyan-400 px-4 py-2 font-semibold text-slate-950 disabled:opacity-40">{busy?'Refreshing…':'Refresh totals'}</button><section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[['Total members',data?.members?.toLocaleString()],['Verified deposits',data?php(data.deposits):undefined],['Verified deposit count',data?.depositCount?.toLocaleString()],['Pending withdrawals',data?php(data.pending):undefined],['Paid withdrawals',data?php(data.paid):undefined]].map(([label,value])=><article className="rounded-xl border border-slate-700 bg-[#10243b] p-5" key={label}><p className="text-slate-300">{label}</p><p className="mt-3 break-words text-2xl font-semibold">{value ?? '—'}</p></article>)}</section><p className="text-sm text-slate-300">Totals use verified PHP payment records. Deposits can remain held for settlement. Processing withdrawals are excluded from paid totals.</p><section className="flex flex-wrap gap-4 rounded-xl border border-slate-700 p-5"><Link className="rounded-lg bg-cyan-400 px-4 py-3 font-semibold text-slate-950" href="/admin/money">Manage payments &amp; withdrawal settings</Link><Link className="rounded-lg bg-slate-800 px-4 py-3 text-cyan-200" href="/admin/business-budget">Business rewards budget</Link><Link className="rounded-lg bg-slate-800 px-4 py-3 text-cyan-200" href="/admin/free-plans">Grant free plan</Link><Link className="rounded-lg bg-slate-800 px-4 py-3 text-cyan-200" href="/admin/users">User management</Link></section></div></main>;
}
