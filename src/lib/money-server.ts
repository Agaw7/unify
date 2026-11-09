import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { productionPaymentsAuthorized, approvalBlockReason } from './payment-readiness';

export function requireProductionApproval() {
  if (!productionPaymentsAuthorized) throw new MoneyError(approvalBlockReason, 503);
}

export class MoneyError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function database() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new MoneyError('Money service is not configured', 503);
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export async function authenticate(request: NextRequest, adminRequired: boolean | 'role-only' = false) {
  const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1];
  if (!token) throw new MoneyError('Please sign in', 401);
  const db = database();
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new MoneyError('Invalid session', 401);
  if (adminRequired) {
    const { data: profile, error: lookup } = await db.from('profiles').select('role').eq('id', data.user.id).single();
    if (lookup || profile?.role !== 'admin') throw new MoneyError('Administrator required', 403);
  }
  if (adminRequired === true) {
    const { data: assurance, error: assuranceError } = await db.auth.mfa.getAuthenticatorAssuranceLevel(token);
    if (assuranceError || assurance?.currentLevel !== 'aal2') throw new MoneyError('Administrator MFA required', 403);
  }
  return { db, user: data.user };
}
export async function rpc(name: string, args: Record<string, unknown>) {
  if (['money_investment_open', 'money_investment_claim', 'money_credit_due_tier_rewards',
    'money_referrals_backfill', 'money_claim_promo', 'money_daily_task_claim'].includes(name)) requireProductionApproval();
  const { data, error } = await database().rpc(name, args);
  if (error) {
    console.error('Money RPC failed', { name, code: error.code });
    const expected = ['Funding reference already allocated','Resolve payment shortfalls before allocating business funds','Insufficient unallocated verified business funds','Insufficient funded business rewards budget for this plan','Member already received a free welcome plan','Member account not found','Product unavailable','Plan request conflict','Funding request conflict','Account restricted','Insufficient available balance','Verified, unrestricted customer required','Verified destination required','Idempotency key conflict','Hourly request limit reached','Daily amount limit reached','Invalid review state','Cannot review own withdrawal','Current identity/ownership approval required or account has a financial restriction','Active refund or dispute prevents release','Unresolved risk alert prevents settlement release','Refund exceeds remaining payment','Insufficient refundable balance','Independent refund sender required','Refund already claimed','Only an unsubmitted refund may be cancelled'];
    throw new MoneyError(expected.find(message => error.message.includes(message)) ?? 'Money operation could not be completed', 409);
  }
  return data;
}
export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function handled(work: () => Promise<NextResponse>) {
  try { return await work(); }
  catch (error) {
    if (error instanceof MoneyError) return json({ error: error.message }, error.status);
    if (error instanceof SyntaxError) return json({ error: 'Invalid JSON' }, 400);
    console.error('Money operation failed', error instanceof Error ? error.name : 'unknown');
    return json({ error: 'Operation could not be confirmed. Refresh its status before retrying.' }, 500);
  }
}
