const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const file = path.join(__dirname, '../src/lib/sandbox-deposit.ts');
const loaded = new Module(file, module);
loaded.filename = file; loaded.paths = module.paths;
loaded._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, file);

test('automatic credit requires provider payment, reference, test mode and exact amount', async () => {
  const oldFetch = global.fetch, oldKey = process.env.PAYMONGO_SECRET_KEY;
  process.env.PAYMONGO_SECRET_KEY = 'sk_test_example';
  const calls = [];
  const db = { rpc: async (...args) => { calls.push(args); return { error: null }; } };
  const deposit = { id: 'transaction', amount: 200, currency: 'PHP', provider: 'paymongo', provider_reference: 'cs_example', status: 'pending' };
  const attributes = () => ({ reference_number: deposit.id, livemode: false,
    payment_intent: { attributes: { status: 'succeeded' } },
    payments: [{ attributes: { status: 'paid' } }],
    line_items: [{ amount: 20000, quantity: 1, currency: 'PHP' }],
  });
  let value = attributes();
  global.fetch = async () => Response.json({ data: { id: 'cs_example', attributes: value } });
  try {
    assert.equal(await loaded.exports.confirmSandboxDeposit(db, deposit), true);
    assert.equal(calls[0][0], 'credit_verified_deposit');
    assert.equal(calls[0][1].p_amount_centavos, 20000);
    assert.equal(calls[0][1].p_event_id, 'auto_reconcile_transaction');
    calls.length = 0;
    value = attributes(); value.payments = [];
    assert.equal(await loaded.exports.confirmSandboxDeposit(db, deposit), false);
    for (const change of [v => { v.reference_number = 'other'; }, v => { v.livemode = true; },
      v => { v.line_items[0].amount = 30000; }, v => { v.line_items[0].currency = 'USD'; }]) {
      value = attributes(); change(value);
      await assert.rejects(loaded.exports.confirmSandboxDeposit(db, deposit));
    }
    assert.equal(calls.length, 0);
    value = attributes();
    await assert.rejects(loaded.exports.confirmSandboxDeposit({ rpc: async () => ({ error: { message: 'failed' } }) }, deposit));
    assert.equal(await loaded.exports.confirmSandboxDeposit(db, { ...deposit, status: 'completed' }), false);
  } finally {
    global.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.PAYMONGO_SECRET_KEY;
    else process.env.PAYMONGO_SECRET_KEY = oldKey;
  }
});

test('pending deposit reconciliation scopes customer requests and never credits an unpaid checkout', async () => {
  const oldFetch = global.fetch, oldKey = process.env.PAYMONGO_SECRET_KEY;
  process.env.PAYMONGO_SECRET_KEY = 'sk_test_example';
  const filters = [];
  const query = { select: () => query, eq: (...args) => { filters.push(args); return query; }, order: () => query,
    limit: async () => ({ data: [{ id: 'transaction', amount: 200, currency: 'PHP', provider: 'paymongo', provider_reference: 'cs_example', status: 'pending' }], error: null }) };
  const db = { from: table => { assert.equal(table, 'payment_transactions'); return query; }, rpc: () => assert.fail('Unpaid deposits must not be credited') };
  global.fetch = async () => Response.json({ data: { id: 'cs_example', attributes: { reference_number: 'transaction', livemode: false, payments: [] } } });
  try {
    assert.deepEqual(await loaded.exports.reconcileSandboxDeposits(db, 'customer'), { checked: 1, credited: 0, issues: 0 });
    assert.ok(filters.some(([key, value]) => key === 'user_id' && value === 'customer'));
    assert.ok(filters.some(([key, value]) => key === 'status' && value === 'pending'));
  } finally {
    global.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.PAYMONGO_SECRET_KEY; else process.env.PAYMONGO_SECRET_KEY = oldKey;
  }
});
