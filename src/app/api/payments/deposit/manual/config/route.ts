import { NextRequest } from 'next/server';
import { authenticate, handled, json, MoneyError } from '@/lib/money-server';
import { productionPaymentsAuthorized } from '@/lib/payment-readiness';

export const dynamic = 'force-dynamic';

function configuredLocalImage(value: string | undefined) {
  return value && /^\/payments\/[A-Za-z0-9._-]+\.(png|jpe?g)$/i.test(value) ? value : null;
}

export function GET(request: NextRequest) {
  return handled(async () => {
    await authenticate(request);
    const methods = [];
    if (process.env.MANUAL_PALAWAN_DEPOSITS_ENABLED === 'true') {
      methods.push({
        id: 'palawan',
        label: 'PalawanPay',
        qr: '/payments/aurevia-palawan-receive.jpg',
        instructions: 'Use the configured AUREVIA PalawanPay receive QR. Confirm that the recipient shown by PalawanPay is the authorized AUREVIA merchant before sending.',
        referenceLabel: 'PalawanPay / InstaPay reference number',
      });
    }

    const gcashQr = configuredLocalImage(process.env.MANUAL_GCASH_QR_IMAGE);
    const gcashMerchant = process.env.MANUAL_GCASH_MERCHANT_NAME?.trim();
    const gcashInstructions = process.env.MANUAL_GCASH_INSTRUCTIONS?.trim();
    if (process.env.MANUAL_GCASH_DEPOSITS_ENABLED === 'true' && gcashQr && gcashMerchant &&
        gcashMerchant.length <= 100 && gcashInstructions && gcashInstructions.length <= 500) {
      methods.push({
        id: 'gcash',
        label: 'GCash',
        qr: gcashQr,
        instructions: `${gcashInstructions} Recipient: ${gcashMerchant}.`,
        referenceLabel: 'GCash transaction reference number',
      });
    }

    if (methods.length > 2) throw new MoneyError('Payment instructions require administrator review', 503);
    return json({ methods, approvalPaused: !productionPaymentsAuthorized });
  });
}
