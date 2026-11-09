import { NextRequest } from 'next/server';
import { authenticate, handled, json, MoneyError, rpc } from '@/lib/money-server';
import { centavos, record, uuid } from '@/lib/money-validation';
import { requireProductionApproval } from '@/lib/money-server';
import { productionPaymentsAuthorized } from '@/lib/payment-readiness';

export const runtime = 'nodejs';
export function GET(request: NextRequest) {
  return handled(async () => {
    const { db, user } = await authenticate(request);
    if (request.nextUrl.searchParams.get('summary') === 'balance') {
      if (productionPaymentsAuthorized) {
        const result = await rpc('money_credit_due_tier_rewards', { p_user: user.id });
        if (Number(result.failed) > 0) throw new MoneyError('Some tier rewards could not be refreshed. Please try again.',503);
      }
      const [wallet, bonus, queue, plans] = await Promise.all([
        db.from('money_wallets').select('available,deposit_available,currency').eq('user_id',user.id).maybeSingle(),
        db.from('money_registration_bonuses').select('revoked_at').eq('user_id',user.id).maybeSingle(),
        db.from('money_registration_bonus_queue').select('status').eq('user_id',user.id).maybeSingle(),
        db.from('money_investments').select('created_at,claimed_days,duration_days').eq('user_id',user.id).order('created_at',{ascending:false}).limit(200),
      ]);
      if (wallet.error || bonus.error || queue.error || plans.error) throw new MoneyError('Unable to refresh wallet summary',503);
      return json({
        wallet: wallet.data ?? { available:0,deposit_available:0,currency:'PHP' },
        registrationBonusGranted: Boolean(bonus.data),
        registrationBonusReclaimed: Boolean(bonus.data?.revoked_at),
        automaticRegistrationBonus: Boolean(queue.data),
        plans: plans.data,
      });
    }
    const results = await Promise.all([
      db.from('money_wallets').select('available,deposit_available,reserved,held,debt,currency').eq('user_id',user.id).maybeSingle(),
      db.from('money_transactions').select('id,kind,amount,method,status,provider_reference,checkout_url,created_at,withdrawal_mode,withdrawal_fee').eq('user_id',user.id).order('created_at',{ ascending:false }).limit(100),
      db.from('money_destinations').select('id,method,account_name,account_number,verified').eq('user_id',user.id).order('created_at',{ ascending:false }),
      db.from('money_customers').select('verified,blocked').eq('user_id',user.id).maybeSingle(),
      db.from('money_verifications').select('id,kind,destination_id,status,provider,evidence_reference,expires_at,created_at,updated_at').eq('user_id',user.id).order('created_at',{ ascending:false }).limit(100),
      db.rpc('money_customer_ready',{ p_user:user.id }),
      db.rpc('money_deposit_ready',{ p_user:user.id }),
      db.from('money_settings').select('withdrawal_mode').eq('id',true).single(),
      db.from('money_registration_bonuses').select('transaction_id,revoked_at').eq('user_id',user.id).maybeSingle(),
      db.from('money_registration_bonus_queue').select('status').eq('user_id',user.id).maybeSingle(),
      db.from('payment_accounts').select('id,provider,account_name,account_number').eq('user_id',user.id).in('provider',['gcash','maya']).order('created_at',{ascending:false}),
    ]);
    if (results.some(r => r.error)) throw new MoneyError('Money database migration is required',503);
    let totalEarned: number | null = null;
    if (request.nextUrl.searchParams.get('summary') === 'profile') {
      totalEarned = 0;
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await db.from('money_transactions').select('amount')
          .eq('user_id', user.id).eq('status', 'completed')
          .in('kind', ['investment_return', 'referral_commission', 'daily_task_reward', 'check_in_reward', 'gift_code_reward'])
          .order('id').range(offset, offset + 499);
        if (error) throw new MoneyError('Unable to load earned rewards', 503);
        for (const entry of data) totalEarned += Number(entry.amount);
        if (data.length < 500) break;
      }
    }
    return json({ manualPalawan:process.env.MANUAL_PALAWAN_DEPOSITS_ENABLED==='true', manualGoTyme:process.env.MANUAL_GOTYME_WITHDRAWALS_ENABLED==='true', enabled:false, payoutsEnabled:false, totalEarned, wallet: results[0].data ?? { available:0,deposit_available:0,reserved:0,held:0,debt:0,currency:'PHP' }, automaticRegistrationBonus:Boolean(results[9].data), registrationBonusGranted:Boolean(results[8].data), registrationBonusReclaimed:Boolean(results[8].data?.revoked_at), legacyDestinations:results[10].data, transactions:results[1].data, destinations:results[2].data, customer:results[3].data,verifications:results[4].data,ready:results[5].data,depositReady:results[6].data,withdrawalMode:results[7].data?.withdrawal_mode });
  });
}
export function POST(request: NextRequest) {
  return handled(async () => {
    const { db, user } = await authenticate(request);
    const body = record(await request.json());
    if (body.action === 'destination') {
        if (!['gcash','maya'].includes(String(body.method)) || typeof body.accountName !== 'string' || body.accountName.trim().length<2 || body.accountName.trim().length>100 || typeof body.accountNumber !== 'string' || !/^09\d{9}$/.test(body.accountNumber)) throw new MoneyError('Enter valid recipient account details');
      const existing=await db.from('money_destinations').select('id,account_name').eq('user_id',user.id).eq('method',body.method).eq('account_number',body.accountNumber).limit(1).maybeSingle();
      if(existing.error) throw new MoneyError('Unable to check linked accounts',503);
      if(existing.data){
        if(existing.data.account_name.trim().toLowerCase()!==body.accountName.trim().toLowerCase()) throw new MoneyError('This number is already linked with a different name. Contact support to update it.');
        return json({success:true,id:existing.data.id,existing:true});
      }
      const { count, error: countError } = await db.from('money_destinations').select('id',{ count:'exact',head:true }).eq('user_id',user.id);
      if (countError) throw new MoneyError('Unable to check destinations',503);
      if ((count ?? 0)>=5) throw new MoneyError('Contact support to replace a destination');
      const { error } = await db.from('money_destinations').insert({ user_id:user.id,method:body.method,account_name:body.accountName.trim(),account_number:body.accountNumber });
      if (error) throw new MoneyError('Unable to save destination',409);
      return json({ success:true });
    }
    requireProductionApproval();
    if (body.action !== 'withdrawal') throw new MoneyError('Automated deposits are unavailable. Use an approved manual deposit process.', 503);
    if (process.env.MANUAL_GOTYME_WITHDRAWALS_ENABLED !== 'true') throw new MoneyError('Manual withdrawals are unavailable', 503);
    if (!uuid(body.idempotencyKey) || !uuid(body.destinationId)) throw new MoneyError('Choose a verified withdrawal destination');
    const { data: settings, error } = await db.from('money_settings').select('withdrawal_mode').eq('id', true).single();
    if (error || settings?.withdrawal_mode !== 'admin_approval') {
      throw new MoneyError('Manual withdrawals require Admin Approval mode', 503);
    }
    let amount: number;
    try { amount = centavos(body.amount, 6000); } catch { throw new MoneyError('Enter a withdrawal amount within the displayed limits, with at most two decimal places'); }
    const transaction = await rpc('money_request_withdrawal', {
      p_user:user.id, p_amount:amount, p_method:body.method, p_key:body.idempotencyKey, p_destination:body.destinationId,
    });
    if (transaction.withdrawal_mode === 'automatic') throw new MoneyError('Automatic payouts are unavailable. Ask an administrator to select Admin Approval mode.', 503);
    return json({ transaction });
  });
}
