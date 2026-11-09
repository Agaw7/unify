import { NextRequest } from 'next/server';
import { authenticate, handled, json, MoneyError, requireProductionApproval, rpc } from '@/lib/money-server';
import { record, uuid } from '@/lib/money-validation';
import { productionPaymentsAuthorized } from '@/lib/payment-readiness';

export function GET(request:NextRequest){return handled(async()=>{
  const {db,user}=await authenticate(request);
  if (productionPaymentsAuthorized && request.nextUrl.searchParams.get('view') === 'portfolio') {
    const result = await rpc('money_credit_due_tier_rewards', { p_user: user.id });
    if (Number(result.failed) > 0) throw new MoneyError('Some tier rewards could not be refreshed. Please try again.',503);
  }
  const [products,investments,budget,wallet,readiness]=await Promise.all([
    db.from('investment_products').select('id,name,price,daily_income,duration_days').order('price'),
    db.from('money_investments').select('*').eq('user_id',user.id).order('created_at',{ascending:false}).limit(200),
    db.from('money_business_budget').select('available').eq('id',true).single(),
    db.from('money_wallets').select('available,deposit_available,currency').eq('user_id',user.id).maybeSingle(),
    db.rpc('money_deposit_ready',{p_user:user.id}),
  ]);
  if(products.error || investments.error || budget.error || wallet.error || readiness.error)throw new MoneyError('Live product wallet is not available. Contact support.',503);
  return json({enabled:false,eligible:readiness.data===true,wallet:wallet.data ?? {available:0,deposit_available:0,currency:'PHP'},products:(products.data ?? []).map(p=>({...p,price:Math.round(Number(p.price)*100),daily_amount:Math.round(Number(p.daily_income)*100),funded:Number(budget.data.available)>=Math.round(Number(p.daily_income)*100)*p.duration_days})),investments:investments.data});
});}
export function POST(request:NextRequest){return handled(async()=>{
  const {db,user}=await authenticate(request);requireProductionApproval();const b=record(await request.json());
  if(b.action==='purchase'){
    if(b.accepted!==true || !uuid(b.productId) || !uuid(b.key))throw new MoneyError('Valid product and request key required');
    if(!Number.isSafeInteger(b.expectedPrice) || Number(b.expectedPrice)<1 || !Number.isSafeInteger(b.expectedDaily) || Number(b.expectedDaily)<1 || (!Number.isInteger(b.expectedDuration) || Number(b.expectedDuration)<1 || Number(b.expectedDuration)>365))throw new MoneyError('Refresh product terms and accept the displayed price before purchasing.',409);
    const {data,error}=await db.rpc('money_investment_purchase_quoted',{p_user:user.id,p_product:b.productId,p_key:b.key,p_expected_price:b.expectedPrice,p_expected_daily:b.expectedDaily,p_expected_duration:b.expectedDuration});
    if(error){
      const expected=['Account restricted','Insufficient funded business rewards budget for this plan','Insufficient available balance','Plan request conflict','Product unavailable','Product terms changed; refresh and accept the updated price before purchasing'];
      console.error('Live product purchase could not be confirmed',{code:error.code});
      throw new MoneyError(expected.find(message=>error.message.includes(message)) ?? 'Purchase could not be confirmed. Refresh your portfolio before retrying.',409);
    }
    return json({investment:data});
  }
  if(b.action==='claim' && uuid(b.investmentId))return json(await rpc('money_investment_claim',{p_user:user.id,p_id:b.investmentId}));
  throw new MoneyError('Invalid investment action');
});}
