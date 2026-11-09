'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ShieldCheck, ArrowLeft } from 'lucide-react';
import { moneyRequest } from '@/lib/money-client';
import styles from './admin-overview.module.css';

type Settings = { reason: string; approvals: { key: string; label: string; status: string }[];
  history: { id: string; approval_type: string; status: string; evidence_reference: string; reviewed_at: string }[] | null };
export default function PaymentSettings() {
  const [data, setData] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { let active = true; moneyRequest('/api/admin/payment-settings').then(result => { if (active) setData(result); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, []);
  return <main className={styles.page}><header className={styles.heading}><div><Link href="/admin"><ArrowLeft size={15} /> Back to admin</Link><p>AUREVIA PAYMENT CONTROLS</p><h1>Payment readiness</h1></div><ShieldCheck size={32} /></header>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {!data && !error && <p role="status">Checking payment readiness…</p>}
    {data && <><section className={styles.panel}><div className={styles.title}><h2>Execution environment</h2><span className={styles.badge}>Live payment paused</span></div><p>{data.reason}</p><div className={styles.metrics}>{['Customer collection', 'Cash withdrawals', 'Deposit commissions', 'Cashable investment rewards'].map(label => <div className={styles.metric} key={label}><div><span>{label}</span><strong>Disabled</strong></div></div>)}</div><p className={styles.notice}>Sandbox and test-payment interfaces are retired. Historical payment records are retained and separate from live wallet accounting.</p></section>
    <section className={styles.panel}><h2>Required independent approvals</h2><div className={styles.records}>{data.approvals.map(a => <div key={a.key}><span>{a.label}</span><span className={styles.badge}>{a.status}</span></div>)}</div><h3>Approved payment purposes</h3><p>No independently verified payment purpose is recorded for activation.</p><p className={styles.notice}>This page has no activation switch. An ordinary administrator cannot authorize live processing or substitute member identity checks for business approval.</p></section>
    <section className={styles.panel}><h2>Compliance review history</h2>{data.history === null ? <p>Review-history schema is not installed. No approval is inferred.</p> : data.history.length ? data.history.map(h => <div key={h.id}><p>{h.approval_type} · {h.status}</p><small>{h.evidence_reference} · {new Date(h.reviewed_at).toLocaleString()}</small></div>) : <p>No independently recorded reviews yet.</p>}</section></>}
  </main>;
}
