
import { redirect } from "next/navigation";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ ref?: string | string[] }> }) {
  const { ref } = await searchParams;
  if (typeof ref === 'string') redirect(`/register?ref=${encodeURIComponent(ref)}`);
  redirect("/login");
}
