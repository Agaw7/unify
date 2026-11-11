import { redirect } from 'next/navigation';

export default function DepositHistoryPage(): never {
  redirect('/dashboard?profile=history');
}
