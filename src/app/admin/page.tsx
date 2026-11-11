import AdminOverview from '@/components/AdminOverview';

export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  const { section } = await searchParams;
  return <AdminOverview initialNav={section === 'free-plan' ? 'FreePlan' : 'Dashboard'} />;
}
