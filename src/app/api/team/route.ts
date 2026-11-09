import { NextRequest } from 'next/server';
import { authenticate, handled, json, MoneyError, rpc } from '@/lib/money-server';
export function GET(request:NextRequest){return handled(async()=>{
  const {db,user}=await authenticate(request);
  const {data:profile,error}=await db.from('profiles').select('short_invite_code,invite_code').eq('id',user.id).single();
  if(error)throw new MoneyError('Unable to load invitation code',503);
  return json({inviteCode:profile.short_invite_code ?? profile.invite_code,team:await rpc('money_live_team',{p_user:user.id})});
});}
