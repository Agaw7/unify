import { NextRequest } from 'next/server';
import { authenticate, handled, json, MoneyError } from '@/lib/money-server';
import { activeAuthUsers } from '@/lib/active-auth-users';

export const dynamic = 'force-dynamic';

export function GET(request: NextRequest) {
  return handled(async () => {
    const { db } = await authenticate(request, 'role-only');
    const hideRecords = request.nextUrl.searchParams.get('hideRecords') === 'true';
    // Read every page: silently accepting the PostgREST row cap makes totals wrong.
    async function rows(table: string, fields: string, order: string, optional = false) {
      const result: Record<string, unknown>[] = [];
      for (let offset = 0; offset < 100000; offset += 500) {
        const page = await db.from(table).select(fields).order(order).range(offset, offset + 499);
        if (page.error) {
          if (optional && ['42P01', 'PGRST205'].includes(page.error.code)) return null;
          throw new MoneyError('Unable to load complete admin records. Please retry.', 503);
        }
        result.push(...page.data as unknown as Record<string, unknown>[]);
        if (page.data.length < 500) return result;
      }
      throw new MoneyError('This dataset requires a paginated reporting export.', 503);
    }
    const [accounts, profiles, invites, grants, funded, transactions, commissions, recordedWallets] = await Promise.all([
      activeAuthUsers(db), rows('profiles', 'id,role,created_at', 'id'),
      rows('team_members', 'id,invited_by,created_at', 'id'),
      rows('sandbox_free_plan_grants', 'id,user_id,created_at', 'id', true),
      rows('money_investments', 'id,user_id,acquisition,name,created_at', 'id', true),
      rows('money_transactions', 'id,user_id,kind,amount,status,created_at', 'id', true),
      rows('money_referral_commissions', 'id,beneficiary_id,depositor_id,level,amount,status,created_at', 'id', true),
      rows('money_wallets', 'user_id,available,deposit_available,reserved,held', 'user_id', true),
    ]);
    const total = (items: Record<string, unknown>[] | null, predicate: (row: Record<string, unknown>) => boolean) => items === null ? null : items.filter(predicate).reduce((n, row) => n + Number(row.amount ?? 0), 0);
    const walletTotal = (wallet: Record<string, unknown>) => ['available','deposit_available','reserved','held'].reduce((n, key) => n + Number(wallet[key] ?? 0), 0);
    const members = (profiles ?? []).filter(p => accounts.has(String(p.id))).map(p => {
      const id = String(p.id);
      const recorded = recordedWallets?.find(w => w.user_id === id);
      const direct = (invites ?? []).filter(i => i.invited_by === id && i.id !== id && accounts.has(String(i.id))).map(i => String(i.id));
      return { id, phone: accounts.get(id)?.phone ?? null, role: String(p.role), joined: String(p.created_at),
        freePlan: (grants ?? []).some(g => g.user_id === id) || (funded ?? []).some(g => g.user_id === id && g.acquisition === 'free_plan'),
        invites: direct,
        recordedBalance: recordedWallets === null ? null : recorded ? walletTotal(recorded) : 0,
        recordedCommission: total(commissions, r => r.beneficiary_id === id && r.status === 'paid'),
        recordedRewards: total(transactions, r => r.user_id === id && r.kind === 'investment_return' && r.status === 'completed'),
        recordedInviteDeposits: total(transactions, r => direct.includes(String(r.user_id)) && r.kind === 'deposit' && r.status === 'completed'),
      };
    });
    const selected = request.nextUrl.searchParams.get('member');
    if (selected && !members.some(m => m.id === selected)) throw new MoneyError('Member not found', 404);
    const filter = (items: Record<string, unknown>[] | null, key = 'user_id') => items?.filter(r => r[key] === selected) ?? null;
    const detail = selected ? { historical: filter(transactions),
      commissions: filter(commissions, 'beneficiary_id'), plans: filter(funded),
      inviteDeposits: transactions?.filter(t => t.kind === 'deposit' && t.status === 'completed' && members.find(m => m.id === selected)?.invites.includes(String(t.user_id))) ?? null,
    } : null;
    const recent = [...(transactions ?? []).map((r): Record<string, unknown> => ({...r, source:'historical'}))]
      .sort((a,b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 8);
    return json({
      members: hideRecords ? [] : members,
      detail: hideRecords ? null : detail,
      detailMember: hideRecords ? null : selected,
      recent: hideRecords ? [] : recent,
      recordsHidden: hideRecords,
      summary: {
      members: members.length,
      freePlans: members.filter(m => m.freePlan).length, invites: members.reduce((n, m) => n + m.invites.length, 0),
      recordedWallets: recordedWallets === null ? null : recordedWallets.reduce((n,w) => n + walletTotal(w), 0),
      membersWithBalance: recordedWallets === null ? null : members.filter(m => Number(m.recordedBalance ?? 0) > 0).length,
      recordedDeposits: total(transactions, r => r.kind === 'deposit' && r.status === 'completed'),
      recordedCommissions: total(commissions, r => r.status === 'paid'),
      recordedRewards: total(transactions, r => r.kind === 'investment_return' && r.status === 'completed'),
      recordedInviteDeposits: total(transactions, r => r.kind === 'deposit' && r.status === 'completed' && (invites ?? []).some(i => i.id === r.user_id && i.invited_by && i.id !== i.invited_by)),
    }, fetchedAt: new Date().toISOString() });
  });
}
