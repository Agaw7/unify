import { NextRequest } from 'next/server';
import { authenticate, handled, json, MoneyError } from '@/lib/money-server';
import { record, uuid } from '@/lib/money-validation';
import { activeAuthUsers } from '@/lib/active-auth-users';

export function GET(request: NextRequest) {
  return handled(async () => {
    const { db } = await authenticate(request, 'role-only');
    async function rows(table: string, fields: string, order: string, filters: Record<string, string> = {}) {
      const result: Record<string, unknown>[] = [];
      for (let offset = 0; offset < 100000; offset += 500) {
        let query = db.from(table).select(fields).order(order);
        for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
        const page = await query.range(offset, offset + 499);
        if (page.error) throw new MoneyError('Unable to load Free Balance invite and deposit records.', 503);
        result.push(...page.data as unknown as Record<string, unknown>[]);
        if (page.data.length < 500) return result;
      }
      throw new MoneyError('Free Balance reporting requires a paginated export.', 503);
    }

    const [accounts, profiles, invites, grants, deposits] = await Promise.all([
      activeAuthUsers(db),
      rows('profiles', 'id,role', 'id'),
      rows('team_members', 'id,invited_by', 'id'),
      rows('money_transactions', 'id,user_id,amount', 'id', { kind: 'admin_balance_grant', status: 'completed' }),
      rows('money_transactions', 'id,user_id,amount', 'id', { kind: 'deposit', status: 'completed' }),
    ]);
    const activeProfiles = profiles.filter(profile => profile.role === 'user' && accounts.has(String(profile.id)));
    const memberIds = new Set(activeProfiles.map(profile => String(profile.id)));
    const grantTotals = new Map<string, number>();
    for (const grant of grants) {
      const memberId = String(grant.user_id);
      if (memberIds.has(memberId)) grantTotals.set(memberId, (grantTotals.get(memberId) ?? 0) + Number(grant.amount));
    }

    const activeInvites = new Map<string, string[]>();
    for (const invite of invites) {
      const memberId = String(invite.id);
      const inviterId = String(invite.invited_by ?? '');
      if (!memberIds.has(inviterId) || memberId === inviterId || !memberIds.has(memberId)) continue;
      const memberInvites = activeInvites.get(inviterId) ?? [];
      memberInvites.push(memberId);
      activeInvites.set(inviterId, memberInvites);
    }

    const depositTotals = new Map<string, number>();
    const invitedMembers = new Set([...activeInvites.values()].flat());
    for (const deposit of deposits) {
      const memberId = String(deposit.user_id);
      if (invitedMembers.has(memberId)) depositTotals.set(memberId, (depositTotals.get(memberId) ?? 0) + Number(deposit.amount));
    }

    const grantedMembers = [...grantTotals.entries()].map(([id, amount]) => {
      const inviteIds = activeInvites.get(id) ?? [];
      const inviteDepositTotal = inviteIds.reduce((total, inviteId) => total + (depositTotals.get(inviteId) ?? 0), 0);
      return {
        id,
        phone: accounts.get(id)?.phone ?? null,
        grantTotal: amount,
        activeInvites: inviteIds.length,
        inviteDepositTotal,
      };
    }).sort((a, b) => b.grantTotal - a.grantTotal);

    return json({ grantedMembers });
  });
}

export function POST(request: NextRequest) {
  return handled(async () => {
    const { db, user } = await authenticate(request, true);
    const body = record(await request.json());
    if (!Array.isArray(body.userIds) || body.userIds.length < 1 || body.userIds.length > 50) {
      throw new MoneyError('Select between 1 and 50 members.');
    }
    const userIds: string[] = [];
    for (const id of body.userIds) {
      if (!uuid(id)) throw new MoneyError('Invalid member selection.');
      userIds.push(id);
    }
    if (new Set(userIds).size !== userIds.length) throw new MoneyError('A member can only be selected once.');
    if (!uuid(body.key)) throw new MoneyError('Invalid grant request. Please try again.');
    if (typeof body.amount !== 'number' || !Number.isFinite(body.amount)) {
      throw new MoneyError('Enter a valid PHP amount.');
    }
    const amount = Math.round(body.amount * 100);
    if (![100000, 150000].includes(amount) || Math.abs(body.amount * 100 - amount) > 0.000001) {
      throw new MoneyError('Choose either ₱1,000 or ₱1,500 per member.');
    }
    if (typeof body.reason !== 'string' || body.reason.trim().length < 5 || body.reason.trim().length > 300) {
      throw new MoneyError('Enter a grant reason from 5 to 300 characters.');
    }

    const { data, error } = await db.rpc('money_admin_grant_balance', {
      p_actor: user.id,
      p_user_ids: userIds,
      p_amount: amount,
      p_key: body.key,
      p_reason: body.reason.trim(),
    });
    if (error) {
      const expected = [
        'Administrator required',
        'Invalid balance grant',
        'Duplicate member selection',
        'Idempotency key conflict',
        'Member not found or ineligible',
        'Account restricted',
        'Insufficient funded business rewards budget',
        'Reward budget unavailable',
      ];
      throw new MoneyError(expected.find(message => error.message.includes(message)) ?? 'Free balance grant could not be confirmed. Refresh before retrying.', 409);
    }
    return json(data);
  });
}
