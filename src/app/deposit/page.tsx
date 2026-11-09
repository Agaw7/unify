import { notFound } from 'next/navigation';
import PaymentPaused from '@/components/PaymentPaused';

export default async function Page({ searchParams }: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const params = await searchParams;
  if (params.mode && params.mode !== 'live') notFound();
  return <PaymentPaused />;
}
