const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function load(relative, stubs) {
  const file = path.resolve(relative);
  const loaded = new Module(file, module);
  loaded.filename = file;
  loaded.paths = module.paths;
  const original = loaded.require.bind(loaded);
  loaded.require = name => Object.hasOwn(stubs, name) ? stubs[name] : original(name);
  loaded._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, file);
  return loaded.exports;
}

function client(results) {
  return {
    from(table) {
      let selection = '';
      const query = {
        select(value) { selection = value; return query; },
        eq() { return query; },
        order() { return query; },
        limit() { return query; },
        in() { return query; },
        then(resolve, reject) {
          return Promise.resolve(results(table, selection)).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

function server(db) {
  class MoneyError extends Error {
    constructor(message, status = 400) { super(message); this.status = status; }
  }
  return {
    MoneyError,
    authenticate: async () => ({ db, user: { id: 'admin' } }),
    handled: async work => {
      try { return await work(); }
      catch (error) { return Response.json({ error: error.message }, { status: error.status ?? 500 }); }
    },
    json: body => Response.json(body),
  };
}

test('deposit and withdrawal lists remain available before optional proof migrations', async () => {
  const adminUser = ['member-1', { id: 'member-1', phone: '+639123456789', user_metadata: { full_name: 'Member One' } }];
  const accounts = new Map([adminUser]);
  const db = client((table, selection) => {
    if (table === 'money_transactions' && selection.includes('payout_proof_path')) {
      return { data: null, error: { code: '42703', message: 'column payout_proof_path does not exist' } };
    }
    if (table === 'money_transactions' && selection.includes('kind') === false && selection.includes('destination_snapshot')) {
      return { data: [{ id: 'withdrawal-1', user_id: 'member-1', method: 'gotyme', amount: 30000, withdrawal_fee: 0, status: 'reserved', created_at: '2026-11-08T00:00:00Z', destination_snapshot: { name: 'Member One', number: '1234567890' }, reviewed_by: null }], error: null };
    }
    if (table === 'money_transactions') {
      return { data: [{ id: 'deposit-1', user_id: 'member-1', method: 'qrph', amount: 30000, status: 'pending', created_at: '2026-11-08T00:00:00Z' }], error: null };
    }
    if (table === 'manual_qrph_deposits' && selection.includes('receipt_path')) {
      return { data: null, error: { code: '42703', message: 'column receipt_path does not exist' } };
    }
    if (table === 'manual_qrph_deposits') {
      return { data: [{ transaction_id: 'deposit-1', instapay_reference: 'PALAWAN-123456', receipt: 'legacy image' }], error: null };
    }
    throw new Error(`Unexpected query: ${table} ${selection}`);
  });
  const common = {
    '@/lib/money-server': server(db),
    '@/lib/active-auth-users': { activeAuthUsers: async () => accounts },
    '@/lib/payment-readiness': { productionPaymentsAuthorized: false },
  };
  const deposits = load('src/app/api/admin/deposits/route.ts', common);
  const withdrawals = load('src/app/api/admin/withdrawals/route.ts', common);

  const depositResponse = await deposits.GET({ nextUrl: new URL('http://localhost/api/admin/deposits') });
  assert.equal(depositResponse.status, 200);
  const depositBody = await depositResponse.json();
  assert.equal(depositBody.transactions[0].channel, 'palawan');
  assert.equal(depositBody.transactions[0].hasReceipt, true);

  const withdrawalResponse = await withdrawals.GET({ nextUrl: new URL('http://localhost/api/admin/withdrawals') });
  assert.equal(withdrawalResponse.status, 200);
  const withdrawalBody = await withdrawalResponse.json();
  assert.equal(withdrawalBody.transactions[0].hasPayoutProof, false);
  assert.equal(withdrawalBody.transactions[0].payout_confirmed_at, null);

  const hiddenDepositResponse = await deposits.GET({
    nextUrl: new URL('http://localhost/api/admin/deposits?hideRecords=true'),
  });
  const hiddenDepositBody = await hiddenDepositResponse.json();
  assert.deepEqual(hiddenDepositBody.transactions, []);
  assert.equal(hiddenDepositBody.recordsHidden, true);

  const hiddenWithdrawalResponse = await withdrawals.GET({
    nextUrl: new URL('http://localhost/api/admin/withdrawals?hideRecords=true'),
  });
  const hiddenWithdrawalBody = await hiddenWithdrawalResponse.json();
  assert.deepEqual(hiddenWithdrawalBody.transactions, []);
  assert.equal(hiddenWithdrawalBody.recordsHidden, true);
});
