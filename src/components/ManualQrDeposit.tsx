'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Download } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { isCatalogProduct } from '@/lib/product-presentation';
import styles from './manual-deposit.module.css';

type Method = {
  id: 'palawan' | 'gcash';
  label: string;
  qr: string;
  instructions: string;
};
type Configuration = { methods: Method[]; approvalPaused: boolean };
type MarketProduct = { name: string; price: number };
const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });

async function authorizedFetch(path: string, init?: RequestInit) {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error('Sign in to continue.');
  const headers = new Headers(init?.headers);
  headers.set('authorization', ['Bearer', data.session.access_token].join(' '));
  return fetch(path, { ...init, headers, cache: 'no-store' });
}

export default function ManualQrDeposit({ initialAmount }: { initialAmount: number }) {
  const [configuration, setConfiguration] = useState<Configuration | null>(null);
  const [marketAmounts, setMarketAmounts] = useState<number[] | null>(null);
  const [amount, setAmount] = useState('');
  const [proof, setProof] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [requestId, setRequestId] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const idempotencyKey = useRef<string | null>(null);
  const method = configuration?.approvalPaused
    ? undefined
    : configuration?.methods.find(item => item.id === 'palawan');

  useEffect(() => {
    let active = true;
    void authorizedFetch('/api/payments/deposit/manual/config')
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? 'Unable to load payment instructions.');
        if (active) setConfiguration(result);
      })
      .catch(cause => {
        if (active) setError(cause instanceof Error ? cause.message : 'Unable to load payment instructions.');
      });
    void authorizedFetch('/api/investments')
      .then(async response => {
        if (!response.ok) throw new Error('Unable to load Market amounts.');
        const result: { products: MarketProduct[] } = await response.json();
        const choices = [...new Set(result.products.filter(product =>
          isCatalogProduct(product.name) && Number.isInteger(product.price) &&
          product.price >= 30_000 && product.price <= 5_000_000).map(product => product.price))]
          .sort((a, b) => a - b);
        if (!active) return;
        setMarketAmounts(choices);
        const initial = choices.find(price => price === Math.round(initialAmount * 100)) ?? choices[0];
        setAmount(initial ? String(initial / 100) : '');
      })
      .catch(() => { if (active) setMarketAmounts([]); });
    return () => { active = false; };
  }, [initialAmount]);

  useEffect(() => {
    if (!proof) { setPreviewUrl(''); return; }
    const url = URL.createObjectURL(proof);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [proof]);

  function chooseProof(file?: File) {
    setError('');
    setNotice('');
    if (!file) { setProof(null); idempotencyKey.current = null; return; }
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size < 8 || file.size > 5 * 1024 * 1024) {
      setError('Choose a PNG, JPG, or JPEG image up to 5 MB.');
      setProof(null);
      idempotencyKey.current = null;
      return;
    }
    setProof(file);
    idempotencyKey.current = null;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || submitted || !proof || !method || !amount) return;
    const form = new FormData(event.currentTarget);
    form.set('method', method.id);
    form.set('receipt', proof);
    idempotencyKey.current ??= crypto.randomUUID();
    form.set('key', idempotencyKey.current);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await authorizedFetch('/api/payments/deposit/manual', { method: 'POST', body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Unable to submit the deposit request.');
      setRequestId(result.id);
      setStatus(result.status ?? 'pending');
      setNotice(result.message ?? 'Deposit request submitted.');
      setSubmitted(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to submit the deposit. Retry with the same details.');
    } finally { setBusy(false); }
  }

  return <main className={styles.page}>
    <header className={styles.pageHeader}>
      <Link href="/dashboard" className={styles.backLink}>← Back to dashboard</Link>
      <span className={styles.brand}>AUREVIA <small>MEMBER DEPOSIT</small></span>
    </header>
    <div className={styles.layout}>
      <section className={styles.instructions}>
        <div className={styles.sectionTitle}><span>01</span><div><h1>Scan to deposit</h1><p>Pay using the AUREVIA PalawanPay QR.</p></div></div>
        {!configuration && !error && <p className={styles.loading}>Loading PalawanPay QR…</p>}
        {configuration && !method && <p className={styles.paused}>PalawanPay deposits are currently unavailable.</p>}
        {method && <>
          <div className={styles.merchantCard}>
            <Image className={styles.qr} src={method.qr} alt={`Configured AUREVIA ${method.label} payment QR`} width={340} height={340} unoptimized />
            <a className={styles.download} href={method.qr} download="AUREVIA-PalawanPay-QR.jpg">
              <Download size={16} aria-hidden="true" /> Download QR
            </a>
            <p className={styles.caution}>Confirm the recipient in your payment app before sending.</p>
          </div>
        </>}
      </section>

      <form className={styles.form} onSubmit={submit}>
        <div className={styles.sectionTitle}><span>02</span><div><h2>Payment details</h2><p>Your wallet is credited after an administrator verifies the payment.</p></div></div>
        <fieldset disabled={busy || submitted || !method || !configuration?.methods.length}>
          <label className={styles.fieldLabel} htmlFor="deposit-amount">Deposit amount</label>
          <select id="deposit-amount" className={styles.input} name="amount" value={amount} required
            onChange={event => { setAmount(event.target.value); idempotencyKey.current = null; }}>
            {!amount && <option value="">{marketAmounts === null ? 'Loading Market amounts…' : 'No Market amounts available'}</option>}
            {marketAmounts?.map(price => (
              <option key={price} value={price / 100}>{peso.format(price / 100)}</option>
            ))}
          </select>
          <label className={styles.fieldLabel} htmlFor="deposit-receipt">Payment screenshot <span>PNG, JPG, JPEG · max 5 MB</span></label>
          <input id="deposit-receipt" className={styles.fileInput} type="file" accept="image/png,image/jpeg,.jpg,.jpeg"
            onChange={event => { chooseProof(event.target.files?.[0]); event.currentTarget.value = ''; }} disabled={busy || submitted} />
          {previewUrl ? <div className={styles.preview}>
            <Image src={previewUrl} alt="Payment screenshot preview" width={720} height={480} unoptimized />
            <div><span>{proof?.name}</span><button type="button" onClick={() => { setProof(null); idempotencyKey.current = null; }} disabled={busy}>Remove</button><label htmlFor="deposit-receipt">Replace</label></div>
          </div> : <label className={styles.upload} htmlFor="deposit-receipt"><strong>Choose payment screenshot</strong><small>PNG, JPG, or JPEG · maximum 5 MB</small></label>}
          <label className={styles.attestation}><input type="checkbox" name="attest" required /><span>I confirm these details and screenshot are accurate. I understand the request stays pending until an administrator verifies the payment in the merchant account.</span></label>
          <button className={styles.submit} type="submit" disabled={busy || !proof || !method || !amount}>{busy ? 'Submitting…' : 'Submit Deposit Request'}</button>
        </fieldset>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {notice && <p className={styles.notice} role="status">{notice}{requestId && <><br />Request ID: <strong>{requestId}</strong><br />Status: <strong>{status}</strong></>}</p>}
        <Link className={styles.historyLink} href="/deposit/history">View deposit history</Link>
      </form>
    </div>
  </main>;
}
