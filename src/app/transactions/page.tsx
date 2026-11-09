
import { redirect } from 'next/navigation';

export default function TransactionsPage(): never {
  redirect('/deposit/history');
}
