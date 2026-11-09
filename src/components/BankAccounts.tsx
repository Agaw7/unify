'use client';
import ManualWithdrawal from '@/components/ManualWithdrawal';

export default function BankAccounts({onBack}:{onBack:()=>void}) {
  return <ManualWithdrawal bankOnly onBack={onBack}/>;
}
