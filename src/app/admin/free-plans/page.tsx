import { redirect } from 'next/navigation';

export default function FreePlansPage(): never {
  redirect('/admin?section=free-plan');
}
