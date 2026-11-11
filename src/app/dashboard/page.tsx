import { redirect } from 'next/navigation';
import Dashboard from '@/components/legacy/Dashboard';

export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<{ profile?: string }> }) {
  const { profile } = await searchParams;
  if (profile === 'verification') redirect('/money#verification');
  const panel = profile === 'history' ? 'Transaction history' : null;
  return <Dashboard initialTab={panel ? 'profile' : 'home'} initialProfilePanel={panel} />;
}
