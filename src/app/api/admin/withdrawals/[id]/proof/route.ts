import { NextRequest, NextResponse } from 'next/server';
import { authenticate, handled, MoneyError } from '@/lib/money-server';
import { uuid } from '@/lib/money-validation';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handled(async () => {
    const { db } = await authenticate(request, 'role-only');
    const { id } = await params;
    if (!uuid(id)) throw new MoneyError('Invalid withdrawal ID');
    const result = await db.from('money_transactions')
      .select('status,payout_proof_path')
      .eq('id', id).eq('kind', 'withdrawal').single();
    if (result.error || !result.data?.payout_proof_path || result.data.status !== 'completed') {
      throw new MoneyError('Payout screenshot not found', 404);
    }
    const file = await db.storage.from('withdrawal-payout-proofs').download(result.data.payout_proof_path);
    if (file.error || !file.data) throw new MoneyError('Unable to load payout screenshot', 503);
    const contentType = result.data.payout_proof_path.endsWith('.png') ? 'image/png' : 'image/jpeg';
    return new NextResponse(file.data, {
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': contentType,
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline',
      },
    });
  });
}
