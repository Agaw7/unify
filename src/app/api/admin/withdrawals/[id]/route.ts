import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { authenticate, handled, json, MoneyError } from '@/lib/money-server';
import { uuid } from '@/lib/money-validation';
import { requireProductionApproval } from '@/lib/money-server';

export const runtime = 'nodejs';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handled(async () => {
    const { user, db } = await authenticate(request, 'role-only');
    requireProductionApproval();
    if (process.env.MANUAL_GOTYME_WITHDRAWALS_ENABLED !== 'true') {
      throw new MoneyError('Manual withdrawals are unavailable', 503);
    }

    const { id } = await params;
    if (!uuid(id)) throw new MoneyError('Invalid withdrawal ID');
    const transaction = await db.from('money_transactions')
      .select('id,user_id,kind,method,status,withdrawal_mode,reviewed_by,destination_snapshot')
      .eq('id', id).single();
    if (transaction.error || !transaction.data) throw new MoneyError('Withdrawal not found', 404);
    const row = transaction.data;
    if (row.kind !== 'withdrawal' || row.status !== 'processing' || row.withdrawal_mode !== 'admin_approval' ||
        !['gotyme', 'gcash', 'maya'].includes(row.method) || row.user_id === user.id || row.reviewed_by === user.id) {
      throw new MoneyError('Withdrawal is not eligible for independent manual payout confirmation', 409);
    }

    const form = await request.formData();
    const proof = form.get('proof');
    if (!(proof instanceof File) || proof.size < 8 || proof.size > 5 * 1024 * 1024 ||
        !['image/png', 'image/jpeg'].includes(proof.type) || form.get('confirm') !== 'true') {
      throw new MoneyError('Upload a PNG or JPEG payout screenshot up to 5 MB and confirm the transfer');
    }
    const bytes = Buffer.from(await proof.arrayBuffer());
    const isPng = bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
    const isJpeg = bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'));
    if ((proof.type === 'image/png' && !isPng) || (proof.type === 'image/jpeg' && !isJpeg)) {
      throw new MoneyError('Screenshot content does not match its image type');
    }

    const path = `${id}/${randomUUID()}.${isPng ? 'png' : 'jpg'}`;
    const uploaded = await db.storage.from('withdrawal-payout-proofs').upload(path, bytes, {
      contentType: isPng ? 'image/png' : 'image/jpeg',
      cacheControl: '0',
      upsert: false,
    });
    if (uploaded.error) throw new MoneyError('Unable to securely store payout screenshot', 503);

    const { error } = await db.rpc('money_confirm_manual_payout', {
      p_id: id,
      p_actor: user.id,
      p_proof_path: path,
      p_confirm: true,
    });
    if (error) {
      const cleanup = await db.storage.from('withdrawal-payout-proofs').remove([path]);
      if (cleanup.error) {
        console.error('Unable to remove unlinked payout proof');
        throw new MoneyError('Payout confirmation failed and the uploaded screenshot could not be cleaned up. Contact an administrator.', 503);
      }
      throw new MoneyError(error.message.includes('Withdrawal already completed')
        ? 'Withdrawal was already completed. Refresh the records.'
        : error.message.includes('Independent payout administrator required')
          ? 'A different authorized administrator must confirm this payout.'
          : 'Withdrawal could not be completed. Refresh its status before retrying.', 409);
    }
    return json({ success: true, confirmedAt: new Date().toISOString() });
  });
}
