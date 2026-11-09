import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { authenticate, handled, json, MoneyError, rpc, requireProductionApproval } from '@/lib/money-server';
import { centavos, record, uuid } from '@/lib/money-validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function schemaNotReady(error: { code?: string; message?: string }) {
  return ['42703', '42P01', 'PGRST200', 'PGRST204', 'PGRST205'].includes(error.code ?? '') ||
    /schema cache|column .* does not exist|relation .* does not exist/i.test(error.message ?? '');
}

export function GET(request: NextRequest) {
  return handled(async () => {
    const { db } = await authenticate(request, 'role-only');
    const id = request.nextUrl.searchParams.get('id');
    if (!uuid(id)) throw new MoneyError('Invalid deposit ID');
    let result = await db.from('manual_qrph_deposits')
      .select('instapay_reference,receipt,receipt_path').eq('transaction_id', id).maybeSingle();
    if (result.error && schemaNotReady(result.error)) {
      result = await db.from('manual_qrph_deposits')
        .select('instapay_reference,receipt').eq('transaction_id', id).maybeSingle();
    }
    if (result.error) throw new MoneyError('Unable to load deposit receipt', 503);
    if (!result.data) throw new MoneyError('Receipt not found', 404);
    let receipt = result.data.receipt;
    if (result.data.receipt_path) {
      const file = await db.storage.from('manual-deposit-receipts').download(result.data.receipt_path);
      if (file.error || !file.data) throw new MoneyError('Unable to load private deposit receipt', 503);
      const bytes = Buffer.from(await file.data.arrayBuffer());
      const type = result.data.receipt_path.endsWith('.png') ? 'png' : 'jpeg';
      receipt = `data:image/${type};base64,${bytes.toString('base64')}`;
    }
    return json({
      instapay_reference: result.data.instapay_reference,
      receipt,
      treasuryEnabled: process.env.MANUAL_TREASURY_ENABLED === 'true',
    });
  });
}

export function POST(request: NextRequest) {
  return handled(async () => {
    const action = request.nextUrl.searchParams.get('action');
    const review = action === 'verify' || action === 'reject';
    const { user, db } = await authenticate(request, review ? 'role-only' : false);
    if (action !== 'reject') requireProductionApproval();
    if (review) {
      if (action === 'reject') {
        const { id, reason } = record(await request.json());
        if (!uuid(id) || typeof reason !== 'string' || reason.trim().length < 5 || reason.length > 500) throw new MoneyError('Enter a rejection reason (5–500 characters)');
        await rpc('money_reject_palawan_deposit', { p_id:id,p_actor:user.id,p_reason:reason.trim() });
        return json({ status:'rejected',message:'Deposit rejected. No wallet credit was added.' });
      }
      const { id, gcashReference, palawanReference, receivedAt } = record(await request.json());
      if (palawanReference !== undefined) {
        if (!uuid(id) || typeof palawanReference !== 'string' || !/^[A-Z0-9-]{5,72}$/.test(palawanReference)) {
          throw new MoneyError('Enter the reference from the received PalawanPay transaction');
        }
        if(process.env.MANUAL_TREASURY_ENABLED==='true'){
          if(typeof receivedAt!=='string' || !Number.isFinite(Date.parse(receivedAt)))throw new MoneyError('Enter the received payment time from PalawanPay history');
          await rpc('money_treasury_approve_deposit',{p_id:id,p_actor:user.id,p_reference:palawanReference,p_received_at:new Date(receivedAt).toISOString()});
        }else await rpc('money_approve_palawan_deposit', { p_id: id, p_actor: user.id, p_reference: palawanReference });
        return json({ status: 'completed', message: 'PalawanPay deposit credited to Deposit Balance.' });
      }
      if (gcashReference !== undefined) {
        if (!uuid(id) || typeof gcashReference !== 'string' || !/^[A-Z0-9-]{5,74}$/.test(gcashReference)) {
          throw new MoneyError('Enter the reference from the received GCash transaction');
        }
        await rpc('money_approve_gcash_deposit', { p_id: id, p_actor: user.id, p_reference: gcashReference });
        return json({ status: 'completed', message: 'GCash deposit credited to Deposit Balance.' });
      }
      throw new MoneyError('Choose a supported manual deposit reference type');
    }

    const palawan = process.env.MANUAL_PALAWAN_DEPOSITS_ENABLED === 'true';
    const gcash = process.env.MANUAL_GCASH_DEPOSITS_ENABLED === 'true' &&
      /^\/payments\/[A-Za-z0-9._-]+\.(png|jpe?g)$/i.test(process.env.MANUAL_GCASH_QR_IMAGE ?? '') &&
      Boolean(process.env.MANUAL_GCASH_MERCHANT_NAME?.trim()) &&
      Boolean(process.env.MANUAL_GCASH_INSTRUCTIONS?.trim());
    if (!palawan && !gcash) throw new MoneyError('Manual deposits are unavailable', 503);
    const form = await request.formData();
    const key = form.get('key');
    const submittedReference = String(form.get('reference') ?? '').trim().toUpperCase();
    const receipt = form.get('receipt');
    const selectedMethod = form.get('method');
    if (selectedMethod !== 'palawan' && selectedMethod !== 'gcash') throw new MoneyError('Choose an available payment method');
    if ((selectedMethod === 'palawan' && !palawan) || (selectedMethod === 'gcash' && !gcash)) {
      throw new MoneyError('The selected payment method is not configured for manual deposits', 503);
    }
    const prefix = selectedMethod === 'palawan' ? 'PALAWAN-' : 'GCASH-';
    if (form.get('attest') !== 'on' || !uuid(key) || !(receipt instanceof File) ||
        !['image/png', 'image/jpeg'].includes(receipt.type) || receipt.size < 8 || receipt.size > 5 * 1024 * 1024) {
      throw new MoneyError('Confirm the deposit details and attach a PNG or JPEG screenshot up to 5 MB');
    }
    const screenshotOnly = selectedMethod === 'palawan' && !submittedReference;
    if (!screenshotOnly && (!/^[A-Z0-9-]{5,72}$/.test(submittedReference) || /^(GCASH|PALAWAN|REQUEST)-/.test(submittedReference))) {
      throw new MoneyError('Enter a valid payment reference');
    }
    const reference = screenshotOnly
      ? 'REQUEST-' + (user.id + key).replaceAll('-', '').toUpperCase()
      : submittedReference;
    let amount: number;
    try { amount = centavos(Number(form.get('amount')), 30000); }
    catch { throw new MoneyError('Enter an amount from ₱300 to ₱50,000'); }
    const bytes = Buffer.from(await receipt.arrayBuffer());
    const png = bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
    const jpeg = bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'));
    if ((receipt.type === 'image/png' && !png) || (receipt.type === 'image/jpeg' && !jpeg)) {
      throw new MoneyError('Screenshot content does not match its file type');
    }
    const extension = png ? 'png' : 'jpg';
    const digest = createHash('sha256').update(bytes).digest('hex');
    const path = `${user.id}/${key}/${digest}.${extension}`;
    const existing = await db.from('manual_qrph_deposits')
      .select('transaction_id').eq('receipt_path', path).maybeSingle();
    if (existing.error) throw new MoneyError('Unable to verify an existing deposit request', 503);
    let uploadedNow = false;
    if (!existing.data) {
      const uploaded = await db.storage.from('manual-deposit-receipts').upload(path, bytes, {
        contentType: png ? 'image/png' : 'image/jpeg',
        cacheControl: '0',
        upsert: true,
      });
      if (uploaded.error) throw new MoneyError('Unable to securely store payment screenshot', 503);
      uploadedNow = true;
    }
    const submission = await db.rpc('money_submit_manual_qrph_private', {
      p_user: user.id,
      p_amount: amount,
      p_key: key,
      p_reference: prefix + reference,
      p_receipt_path: path,
    });
    if (submission.error || typeof submission.data !== 'string') {
      if (uploadedNow) {
        const linked = await db.from('manual_qrph_deposits')
          .select('transaction_id').eq('receipt_path', path).maybeSingle();
        if (linked.error) throw new MoneyError('Deposit submission failed; screenshot cleanup needs administrator attention', 503);
        if (!linked.data) {
          const removed = await db.storage.from('manual-deposit-receipts').remove([path]);
          if (removed.error) throw new MoneyError('Deposit submission failed and the uploaded screenshot could not be removed', 503);
        }
      }
      throw new MoneyError(submission.error?.message.includes('Idempotency key conflict')
        ? 'This request key was already used with different payment details'
        : 'Deposit request could not be saved. Check its status before retrying.', 409);
    }
    const transaction = await db.from('money_transactions').select('status').eq('id', submission.data).single();
    if (transaction.error) throw new MoneyError('Deposit was saved but its current status could not be loaded', 503);
    return json({
      id: submission.data,
      status: transaction.data.status,
      message: transaction.data.status === 'pending'
        ? 'Deposit request submitted. It remains pending until payment is independently verified.'
        : `This deposit request already has status: ${transaction.data.status}.`,
    });
  });
}
