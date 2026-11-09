import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function Layout(): never {
  redirect('/withdrawal');
}
