import { notFound } from 'next/navigation';
import PaymentPaused from '@/components/PaymentPaused';
import ManualQrDeposit from '@/components/ManualQrDeposit';

export default async function Page({ searchParams }: {
  searchParams: Promise<{ mode?: string; payment?: string; amount?: string }>;
}) {
  const params = await searchParams;
  if (params.mode && params.mode !== 'live') notFound();
  if (params.payment !== 'manual') return <PaymentPaused />;
  const parsedAmount = Number(params.amount);
  const initialAmount = Number.isFinite(parsedAmount) && parsedAmount >= 300 && parsedAmount <= 50000
    ? parsedAmount
    : 300;
  return <ManualQrDeposit initialAmount={initialAmount} />;
}
