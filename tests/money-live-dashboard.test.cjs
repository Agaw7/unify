const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

test('admin dashboard uses ledger records and never queries an external payment account', async () => {
  const file = path.resolve('src/app/api/admin/live-dashboard/route.ts');
  let role = 'admin';
  const tables = [];
  const now = new Date().toISOString();
  const old = '2020-01-01T00:00:00Z';
  const accounts = new Map([['admin', {}], ['member', { last_sign_in_at: now }]]);
  const rows = {
    profiles: [{ id: 'admin', role: 'admin', created_at: now }, { id: 'member', role: 'user', created_at: old }],
    money_transactions: [
      { id: 'paid', kind: 'deposit', amount: 20000, status: 'completed', created_at: old },
      { id: 'pending', kind: 'deposit', amount: 50000, status: 'pending', created_at: now },
      { id: 'out', kind: 'withdrawal', amount: 10000, withdrawal_fee: 500, status: 'completed', created_at: old },
      { id: 'approved', kind: 'withdrawal', amount: 12800, withdrawal_fee: 640, status: 'approved', created_at: now },
      { id: 'reserved', kind: 'withdrawal', amount: 6000, status: 'reserved', created_at: now },
      { id: 'processing', kind: 'withdrawal', amount: 5000, status: 'processing', created_at: now },
    ],
    money_ledger: [
      { id: 1, transaction_id: 'paid', action: 'deposit', created_at: now },
      { id: 2, transaction_id: 'out', action: 'settle', created_at: now },
      { id: 3, transaction_id: 'out', action: 'settle', created_at: now },
      { id: 4, transaction_id: 'processing', action: 'settle', created_at: now },
    ],
  };
  const db = {
    from: table => {
      tables.push(table);
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        order: () => query,
        single: async () => ({ data: table === 'profiles'
          ? { role }
          : { available: 10000, reserved: 2000, sales: 0, funded: 12000 }, error: null }),
        range: async () => ({ data: rows[table] ?? [], error: null }),
      };
      return query;
    },
  };
  const server = {
    MoneyError: class extends Error { constructor(message, status = 400) { super(message); this.status = status; } },
    authenticate: async () => ({ db, user: { id: 'admin' } }),
    handled: async work => {
      try { return await work(); }
      catch (error) { return { status: error.status, body: { error: error.message } }; }
    },
    json: body => ({ status: 200, body }),
  };
  const loaded = new Module(file, module);
  loaded.filename = file;
  loaded.paths = module.paths;
  const original = loaded.require.bind(loaded);
  loaded.require = name => name === '@/lib/money-server'
    ? server
    : name === '@/lib/active-auth-users'
      ? { activeAuthUsers: async () => accounts }
      : name === '@/lib/business-budget-summary'
        ? { businessBudgetSummary: () => ({ overall: 120, available: 100, reserved: 20, sales: 0, funded: 120 }) }
        : original(name);
  loaded._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, file);

  const originalFetch = global.fetch;
  let externalCalls = 0;
  global.fetch = async () => { externalCalls++; throw new Error('No external requests expected'); };
  try {
    let response = await loaded.exports.GET({});
    let result = response.body;
    assert.equal(result.totalDeposits, 200);
    assert.equal(result.depositsToday, 200);
    assert.equal(result.totalWithdrawalsPaid, 95);
    assert.equal(result.withdrawalsPaidToday, 95);
    assert.equal(result.pendingWithdrawals, 238);
    assert.equal(result.pendingDeposits, 500);
    assert.equal(result.signinsToday, 1);
    assert.equal(result.totalMembers, 1);
    assert.equal(result.mode, 'live');
    assert.ok(!Object.keys(result).some(key => /provider|paymongo/i.test(key)));
    assert.ok(tables.every(table => ['profiles', 'money_transactions', 'money_ledger', 'money_business_budget'].includes(table)));
    assert.equal(externalCalls, 0);

    accounts.set('member', { last_sign_in_at: now, app_metadata: { aromeva_archived_at: now } });
    rows.money_transactions[0].user_id = 'member';
    rows.money_transactions[2].user_id = 'admin';
    rows.money_ledger[1].created_at = old;
    result = (await loaded.exports.GET({})).body;
    assert.equal(result.totalMembers, 0);
    assert.equal(result.signinsToday, 0);
    assert.equal(result.totalDeposits, 0);
    assert.equal(result.totalWithdrawalsPaid, 0);
    assert.equal(result.pendingWithdrawals, 238);

    accounts.set('new-member', { last_sign_in_at: now });
    rows.profiles.push({ id: 'new-member', role: 'user', created_at: now });
    rows.money_transactions.push({ id: 'new-deposit', user_id: 'new-member', kind: 'deposit', amount: 30000, status: 'completed' });
    rows.money_transactions.push({ id: 'new-payout', user_id: 'new-member', kind: 'withdrawal', amount: 12800, withdrawal_fee: 640, status: 'completed' });
    rows.money_ledger.push({ id: 5, transaction_id: 'new-deposit', action: 'deposit', created_at: now });
    rows.money_ledger.push({ id: 6, transaction_id: 'new-payout', action: 'settle', created_at: now });
    result = (await loaded.exports.GET({})).body;
    assert.equal(result.totalMembers, 1);
    assert.equal(result.signinsToday, 1);
    assert.equal(result.totalDeposits, 300);
    assert.equal(result.totalWithdrawalsPaid, 121.6);

    role = 'member';
    const before = externalCalls;
    response = await loaded.exports.GET({});
    assert.equal(response.status, 403);
    assert.equal(externalCalls, before);
  } finally {
    global.fetch = originalFetch;
  }
});
