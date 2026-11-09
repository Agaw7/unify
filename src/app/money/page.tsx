import { redirect } from 'next/navigation';
import MoneyWalletPage from '@/components/MoneyWalletPage';
export default async function Page({searchParams}:{searchParams:Promise<{checkout?:string}>}){
 const {checkout}=await searchParams;
 // Older provider checkouts can still contain the previous wallet return URL.
 if(checkout==='cancelled' || checkout==='returned')redirect('/dashboard');
 return <MoneyWalletPage/>;
}
