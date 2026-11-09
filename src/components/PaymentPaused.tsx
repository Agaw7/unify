import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { approvalBlockReason } from '@/lib/payment-readiness';

export default function PaymentPaused() {
  return <main className="mx-auto max-w-xl space-y-5 p-6 text-purple-950"><Link href="/dashboard">← Back to Home</Link><section className="space-y-4 rounded-3xl border border-purple-200 bg-white p-6 shadow-sm"><ShieldCheck aria-hidden="true" className="text-purple-700" size={32} /><h1 className="text-2xl font-bold">Deposits are paused</h1><p>{approvalBlockReason}</p><p>Your existing records and balances are preserved. Manual requests stay pending until an administrator independently verifies receipt.</p><Link href="/deposit/manual" className="block font-semibold underline">Submit a manual deposit request for review</Link><Link href="/deposit/history" className="font-semibold underline">View deposit history</Link></section></main>;
}
