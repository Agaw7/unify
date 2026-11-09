import { NextRequest } from 'next/server';
import { authenticate, handled, json, MoneyError } from '@/lib/money-server';

export function GET(request: NextRequest) {
  return handled(async () => {
    const { db, user } = await authenticate(request);
    const mode = request.nextUrl.searchParams.get('mode') ?? 'live';
    const kind = request.nextUrl.searchParams.get('kind') ?? 'deposit';
    const pageText = request.nextUrl.searchParams.get('page') ?? '1';
    if (mode !== 'live') throw new MoneyError('Sandbox payment history is no longer available', 404);
    if (!['deposit', 'withdrawal'].includes(kind) || !/^[1-9]\d{0,4}$/.test(pageText)) throw new MoneyError('Invalid history page');
    const page = Number(pageText), pageSize = 25;
    const query = db.from('money_transactions')
      .select('id,amount,status,method,created_at,destination_snapshot', { count: 'exact' })
      .eq('user_id', user.id)
      .eq('kind', kind);
    const { data, error, count } = await query
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (error) throw new MoneyError(`Unable to load ${kind} history. Please try again.`, 503);
    type Row = { id: string; amount: number; status: string; method?: string; created_at: string; destination_snapshot?: { number?: string } | null };
    const rows = (data ?? []) as unknown as Row[];
    const entries = rows.map(row => {
      const number = row.destination_snapshot?.number;
      return { id: row.id, amount: Number(row.amount) / 100, status: row.status, method: row.method ?? null, created_at: row.created_at, destination: kind === 'withdrawal' && number ? `****${String(number).slice(-4)}` : null };
    });
    return json({ entries, total: count ?? 0, page, pageSize });
  });
}
