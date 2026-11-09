const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

test('investment API keeps wallet reporting read-only and production purchases hard-locked', async () => {
  const file = path.resolve('src/app/api/investments/route.ts');
  const product = '11111111-1111-4111-8111-111111111111';
  const scopes = [];
  let auth = true;
  let purchaseCalls = 0;
  const rows = {
    investment_products: [{ id: product, name: 'Product', price: 200, daily_income: 50, duration_days: 365 }],
    money_investments: [],
    money_business_budget: { available: 17000 },
    money_wallets: { available: 3000, deposit_available: 0, currency: 'PHP' },
  };
  const db = {
    from: table => {
      const result = { data: rows[table], error: null };
      const query = {
        select: () => query,
        eq: (column, value) => { if (table === 'money_wallets' || table === 'money_investments') scopes.push([table, column, value]); return query; },
        order: () => query,
        limit: async () => result,
        single: async () => result,
        maybeSingle: async () => result,
        then: resolve => Promise.resolve(result).then(resolve),
      };
      return query;
    },
    rpc: async name => {
      if (name === 'money_deposit_ready') return { data: true, error: null };
      purchaseCalls++;
      throw new Error(`Unexpected RPC: ${name}`);
    },
  };
  const server = {
    MoneyError: class extends Error { constructor(message, status = 400) { super(message); this.status = status; } },
    authenticate: async () => {
      if (!auth) throw new server.MoneyError('Please sign in', 401);
      return { db, user: { id: 'trusted-user' } };
    },
    requireProductionApproval: () => { throw new server.MoneyError('Production processing is unauthorized', 503); },
    handled: async work => {
      try { return await work(); }
      catch (error) { return { status: error.status, body: { error: error.message } }; }
    },
    json: (body, status = 200) => ({ body, status }),
    rpc: async () => { throw new Error('Unquoted financial RPC must not be used'); },
  };
  const loaded = new Module(file, module);
  loaded.filename = file;
  loaded.paths = module.paths;
  const original = loaded.require.bind(loaded);
  loaded.require = name => name === '@/lib/money-server'
    ? server
    : name === '@/lib/payment-readiness'
      ? { productionPaymentsAuthorized: false }
      : name === '@/lib/money-validation'
        ? { record: value => value, uuid: value => typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value) }
        : original(name);
  loaded._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, file);

  const get = await loaded.exports.GET({});
  assert.equal(get.body.enabled, false);
  assert.equal(get.body.wallet.available, 3000);
  assert.deepEqual(scopes, [['money_investments', 'user_id', 'trusted-user'], ['money_wallets', 'user_id', 'trusted-user']]);
  const request = body => loaded.exports.POST({ json: async () => body });
  auth = false;
  assert.equal((await request({ action: 'purchase' })).status, 401);
  auth = true;
  const result = await request({ action: 'purchase', productId: product, accepted: true });
  assert.equal(result.status, 503);
  assert.equal(purchaseCalls, 0);
});
