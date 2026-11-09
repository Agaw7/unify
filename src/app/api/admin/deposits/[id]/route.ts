import { NextRequest } from 'next/server';
import { authenticate, handled, json, MoneyError, rpc, requireProductionApproval } from '@/lib/money-server';
import { record, uuid } from '@/lib/money-validation';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handled(async () => {
    const { user, db } = await authenticate(request, 'role-only');
    const { id } = await params;
    if (!uuid(id)) throw new MoneyError('Invalid deposit ID');
    const body = record(await request.json());
    if (body.action !== 'approve' && body.action !== 'reject') throw new MoneyError('Choose approve or reject');
    const { data: transaction, error } = await db.from('money_transactions')
      .select('id,user_id,method,status,amount,provider_reference,manual_qrph_deposits(instapay_reference)')
      .eq('id', id).eq('kind', 'deposit').maybeSingle();
    if (error || !transaction) throw new MoneyError('Deposit not found', 404);
    if (transaction.user_id === user.id) throw new MoneyError('Administrators cannot review their own deposit', 403);
    const manual = Array.isArray(transaction.manual_qrph_deposits)
      ? transaction.manual_qrph_deposits[0]
      : transaction.manual_qrph_deposits;
    if (!manual) throw new MoneyError('This deposit does not use the manual review workflow', 409);

    if (body.action === 'reject') {
      if (typeof body.reason !== 'string' || body.reason.trim().length < 5 || body.reason.length > 500) {
        throw new MoneyError('Enter a rejection reason (5–500 characters)');
      }
      await rpc('money_reject_manual_qrph', { p_id: id, p_actor: user.id, p_reason: body.reason.trim() });
      return json({ status: 'rejected', message: 'Deposit rejected. No wallet credit was added.' });
    }

    requireProductionApproval();
    if (transaction.status !== 'pending' || !manual.instapay_reference) {
      throw new MoneyError('Only a pending deposit can be approved', 409);
    }
    if (typeof body.confirm !== 'boolean' || body.confirm !== true ||
        typeof body.paymentReference !== 'string' || !/^[A-Z0-9-]{5,72}$/.test(body.paymentReference)) {
      throw new MoneyError('Confirm the received payment and enter its reference from the merchant account history');
    }
    if (manual.instapay_reference !== `PALAWAN-${body.paymentReference}` &&
        manual.instapay_reference !== `GCASH-${body.paymentReference}`) {
      throw new MoneyError('The verified merchant reference does not match the submitted deposit request');
    }
    if (manual.instapay_reference.startsWith('PALAWAN-')) {
      if (process.env.MANUAL_TREASURY_ENABLED === 'true') {
        if (typeof body.receivedAt !== 'string' || !Number.isFinite(Date.parse(body.receivedAt))) {
          throw new MoneyError('Enter the actual payment time from PalawanPay history');
        }
        await rpc('money_treasury_approve_deposit', {
          p_id: id,
          p_actor: user.id,
          p_reference: body.paymentReference,
          p_received_at: new Date(body.receivedAt).toISOString(),
        });
      } else {
        await rpc('money_approve_palawan_deposit', {
          p_id: id,
          p_actor: user.id,
          p_reference: body.paymentReference,
        });
      }
    } else {
      await rpc('money_approve_gcash_deposit', {
        p_id: id,
        p_actor: user.id,
        p_reference: body.paymentReference,
      });
    }
    return json({ status: 'approved', message: 'Verified deposit credited through the authorized wallet ledger.' });
  });
}
