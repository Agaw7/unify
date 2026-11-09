import { redirect } from 'next/navigation';

export default async function Page({ searchParams }: { searchParams: Promise<{ amount?: string }> }) {
  const { amount } = await searchParams;
  const params = new URLSearchParams({ mode: 'live', payment: 'manual' });
  if (amount) params.set('amount', amount);
  redirect(`/deposit/checkout?${params}`);
}
