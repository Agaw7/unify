import { NextRequest, NextResponse } from 'next/server';
import { authenticate, handled, MoneyError } from '@/lib/money-server';
import { uuid } from '@/lib/money-validation';

export const runtime = 'nodejs';

function schemaNotReady(error: { code?: string; message?: string }) {
  return ['42703', '42P01', 'PGRST200', 'PGRST204', 'PGRST205'].includes(error.code ?? '') ||
    /schema cache|column .* does not exist|relation .* does not exist/i.test(error.message ?? '');
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handled(async () => {
    const { db } = await authenticate(request, 'role-only');
    const { id } = await params;
    if (!uuid(id)) throw new MoneyError('Invalid deposit ID');
    let result = await db.from('manual_qrph_deposits')
      .select('receipt,receipt_path').eq('transaction_id', id).maybeSingle();
    if (result.error && schemaNotReady(result.error)) {
      result = await db.from('manual_qrph_deposits')
        .select('receipt').eq('transaction_id', id).maybeSingle();
    }
    if (result.error || !result.data) throw new MoneyError('Payment screenshot not found', 404);

    let image: Blob;
    let contentType: string;
    if (result.data.receipt_path) {
      const stored = await db.storage.from('manual-deposit-receipts').download(result.data.receipt_path);
      if (stored.error || !stored.data) throw new MoneyError('Unable to load private payment screenshot', 503);
      image = stored.data;
      contentType = result.data.receipt_path.endsWith('.png') ? 'image/png' : 'image/jpeg';
    } else if (typeof result.data.receipt === 'string') {
      const legacy = result.data.receipt.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/);
      if (!legacy) throw new MoneyError('Legacy payment screenshot is invalid', 503);
      image = new Blob([Buffer.from(legacy[2], 'base64')]);
      contentType = legacy[1] === 'png' ? 'image/png' : 'image/jpeg';
    } else {
      throw new MoneyError('Payment screenshot not found', 404);
    }

    return new NextResponse(image, {
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': contentType,
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline',
      },
    });
  });
}
