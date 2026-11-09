const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function load(relative, stubs = {}) {
  const file = path.resolve(relative);
  const loaded = new Module(file, module);
  loaded.filename = file;
  loaded.paths = module.paths;
  const original = loaded.require.bind(loaded);
  loaded.require = name => Object.hasOwn(stubs, name) ? stubs[name] : original(name);
  loaded._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, file);
  return loaded.exports;
}

test('deposit page opens manual payment and rejects sandbox URLs', async () => {
  const page = load('src/app/deposit/page.tsx', {
    'next/navigation': {
      notFound: () => { throw new Error('notFound'); },
      redirect: url => { throw new Error(url); },
    },
  });
  await assert.rejects(page.default({ searchParams: Promise.resolve({ mode: 'test' }) }), /notFound/);
  await assert.rejects(page.default({ searchParams: Promise.resolve({}) }),
    error => error.message === '/deposit/checkout?mode=live&payment=manual');
  await assert.rejects(page.default({ searchParams: Promise.resolve({ mode: 'live', amount: '500' }) }),
    error => error.message === '/deposit/checkout?mode=live&payment=manual&amount=500');
});

class MoneyError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function paymentRoute() {
  const tables = [];
  const values = {
    money_wallets: { available: 12345, reserved: 20000, held: 5000, deposit_available: 10000 },
    money_customers: { verified: true, blocked: false },
  };
  const db = {
    rpc: async () => ({ data: true, error: null }),
    from: table => {
      tables.push(table);
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: values[table] ?? null, error: null }) };
      return query;
    },
  };
  const server = {
    MoneyError,
    authenticate: async () => ({ db, user: { id: 'member' } }),
    json: (body, status = 200) => Response.json(body, { status }),
    handled: async work => {
      try { return await work(); }
      catch (error) { return Response.json({ error: error.message }, { status: error.status ?? 500 }); }
    },
  };
  return {
    tables,
    api: load('src/app/api/payments/deposit/route.ts', {
      'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
      '@/lib/money-server': server,
      '@/lib/money-validation': { uuid: value => typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value) },
    }),
  };
}

test('deposit status endpoint returns ledger balances without enabling automated payments', async () => {
  const { api, tables } = paymentRoute();
  const response = await api.GET({ nextUrl: new URL('https://aurevia.example/api/payments/deposit?mode=live') });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.enabled, false);
  assert.equal(result.balance, 473.45);
  assert.equal(result.available, 123.45);
  assert.equal(result.held, 50);
  assert.equal(result.depositBalance, 100);
  assert.ok(tables.includes('money_wallets'));
  assert.ok(tables.includes('money_customers'));
  assert.ok(!tables.some(table => ['wallet_accounts', 'sandbox_wallets', 'payment_transactions'].includes(table)));
});

test('automated checkout creation stays disabled', async () => {
  const { api } = paymentRoute();
  const response = await api.POST();
  assert.equal(response.status, 404);
  assert.match((await response.json()).error, /disabled/i);
});
