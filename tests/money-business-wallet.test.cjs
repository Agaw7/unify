const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function load() {
  const file = path.resolve('src/app/api/admin/business-budget/route.ts');
  const loaded = new Module(file, module);
  const db = {
    from: table => {
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        limit: () => query,
        single: async () => ({ data: { available: 10000, reserved: 2000, sales: 0, funded: 12000 }, error: null }),
        then: resolve => Promise.resolve({ data: table === 'money_business_funding' ? [{ id: 'funding-1', amount: 5000, reference: 'manual-source', created_at: '2026-01-01' }] : null, error: null }).then(resolve),
      };
      return query;
    },
  };
  const server = {
    MoneyError: class extends Error { constructor(message, status = 400) { super(message); this.status = status; } },
    authenticate: async () => ({ db }),
    json: body => Response.json(body),
    handled: async work => {
      try { return await work(); }
      catch (error) { return Response.json({ error: error.message }, { status: error.status ?? 500 }); }
    },
  };
  loaded.filename = file;
  loaded.paths = module.paths;
  const original = loaded.require.bind(loaded);
  loaded.require = name => name === '@/lib/money-server' ? server : original(name);
  loaded._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, file);
  return loaded.exports;
}

test('budget reports recorded ledger values but cannot fetch or allocate provider funds', async () => {
  const route = load();
  const report = await (await route.GET({})).json();
  assert.equal(report.budget.available, 10000);
  assert.equal(report.funding[0].reference, 'manual-source');
  const allocation = await route.POST();
  assert.equal(allocation.status, 503);
  assert.match((await allocation.json()).error, /approved manual accounting process/i);
});
