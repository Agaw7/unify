import { NextRequest } from 'next/server';
import { authenticate, handled, json, MoneyError } from '@/lib/money-server';
import { record, uuid } from '@/lib/money-validation';
import { isCatalogProduct, productDetails } from '@/lib/product-presentation';
export const runtime='nodejs';
async function admin(request:NextRequest){
 const session=await authenticate(request);
 const {data,error}=await session.db.from('profiles').select('role').eq('id',session.user.id).single();
 if(error || data?.role!=='admin')throw new MoneyError('Administrator access required.',403);
 return session;
}
export function GET(request:NextRequest){return handled(async()=>{
 const {db}=await admin(request);
 const grantId = request.nextUrl.searchParams.get('grant');
 if (grantId !== null) {
  const page = Number(request.nextUrl.searchParams.get('page') ?? '0');
  if (!uuid(grantId) || !Number.isSafeInteger(page) || page < 0 || page > 100000) {
   throw new MoneyError('Invalid free plan or invite page.');
  }
  const [sandbox, funded] = await Promise.all([
   db.from('sandbox_free_plan_grants').select('user_id').eq('id', grantId).maybeSingle(),
   db.from('money_investments').select('user_id').eq('id', grantId).eq('acquisition', 'free_plan').maybeSingle(),
  ]);
  if (sandbox.error || funded.error) throw new MoneyError('Unable to load the free plan.', 503);
  const grant = sandbox.data ?? funded.data;
  if (!grant) throw new MoneyError('Free plan grant not found.', 404);

  const pageSize = 20;
  const {data: invites, count, error: inviteError} = await db.from('team_members')
   .select('id,created_at', {count: 'exact'}).eq('invited_by', grant.user_id).neq('id', grant.user_id)
   .order('created_at', {ascending: false}).order('id').range(page * pageSize, (page + 1) * pageSize - 1);
  if (inviteError) throw new MoneyError('Unable to load direct invites.', 503);

  async function hasDeposit(userId: string) {
   const {data, error} = await db.from('money_transactions').select('id')
    .eq('user_id', userId).eq('kind', 'deposit').eq('status', 'completed').limit(1).maybeSingle();
   if (error) throw new MoneyError('Unable to verify deposit status.', 503);
   return Boolean(data);
  }
  const [recipientDeposited, members] = await Promise.all([
   hasDeposit(grant.user_id),
   Promise.all(invites.map(async invite => {
    const [account, deposited] = await Promise.all([
     db.auth.admin.getUserById(invite.id),
     hasDeposit(invite.id),
    ]);
    const phone = account.data.user?.phone;
    return {...invite, phoneLast4: phone?.slice(-4) ?? null, deposited};
   })),
  ]);
  return json({recipientDeposited, members, total: count ?? 0, hasMore: (page + 1) * pageSize < (count ?? 0)});
 }
 const [products, sandbox, funded] = await Promise.all([
  db.from('investment_products').select('id,name,price,daily_income,duration_days').order('price'),
  db.from('sandbox_free_plan_grants').select('id,user_id,product_id,investment_id,granted_by,note,created_at').order('created_at',{ascending:false}).limit(100),
  db.from('money_investments').select('id,user_id,product_id,granted_by,note,created_at').eq('acquisition','free_plan').order('created_at',{ascending:false}).limit(100),
 ]);
 if (products.error || sandbox.error || funded.error) throw new MoneyError('Unable to load free plans.', 503);
 const marketProducts = (products.data ?? [])
  .filter(product => isCatalogProduct(product.name))
  .sort((a, b) => (productDetails(a.name)?.tier ?? Infinity) - (productDetails(b.name)?.tier ?? Infinity));
 const grants = [
  ...sandbox.data.map(grant => ({...grant, mode: 'test'})),
  ...funded.data.map(grant => ({...grant, investment_id: grant.id, mode: 'funded'})),
 ].sort((a,b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0,100);
 return json({products: marketProducts, grants});
});}
export function POST(request:NextRequest){return handled(async()=>{
 const {db,user}=await authenticate(request,'role-only');const b=record(await request.json());
 if(!uuid(b.userId) || !uuid(b.productId) || !uuid(b.key) || typeof b.note!=='string' || b.note.length>300)throw new MoneyError('Select a member, product, and valid grant details.');
 const {data: product, error: productError} = await db.from('investment_products').select('name').eq('id', b.productId).maybeSingle();
 if (productError) throw new MoneyError('Unable to verify the selected Market product.', 503);
 if (!product || !isCatalogProduct(product.name)) throw new MoneyError('Select a product currently shown in Market.');
 const {data,error}=await db.rpc('money_investment_open',{p_actor:user.id,p_user:b.userId,p_product:b.productId,p_key:b.key,p_note:b.note.trim()});
 if(error){const expected=['Member already received a free welcome plan','Member account not found','Product unavailable','Plan request conflict','Insufficient funded business rewards budget for this plan','Account restricted'];throw new MoneyError(expected.find(m=>error.message.includes(m)) ?? 'Unable to grant the free plan. Refresh before retrying.',409);}
 return json({grant:data,message:'Funded free plan added to My Tier. Rewards were reserved from the business budget.'});
});}
