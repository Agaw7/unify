import { notFound, redirect } from 'next/navigation';

export default async function Page({ searchParams }: {
  searchParams: Promise<{ mode?: string; amount?: string }>;
}) {
  const params = await searchParams;
  if (params.mode && params.mode !== 'live') notFound();
  const payment = new URLSearchParams({ mode: 'live', payment: 'manual' });
  if (params.amount) payment.set('amount', params.amount);
  redirect(`/deposit/checkout?${payment}`);
}
