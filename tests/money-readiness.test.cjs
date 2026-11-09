const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function load(role) {
  const file = path.resolve('src/app/api/admin/money/readiness/route.ts');
  const loaded = new Module(file, module);
  const query = { select: () => query, eq: () => query, single: async () => ({ data: { role }, error: null }) };
  const server = {
    MoneyError: class extends Error { constructor(message, status = 400) { super(message); this.status = status; } },
    authenticate: async () => ({ user: { id: 'admin' }, db: { from: () => query } }),
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
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, file);
  return loaded.exports.GET;
}

test('payment readiness is admin-only and reports automated processing unavailable', async () => {
  assert.equal((await load('member')({})).status, 403);
  const result = await (await load('admin')({})).json();
  assert.equal(result.automatedPaymentsAvailable, false);
  assert.equal(result.productionPaymentsAuthorized, false);
  assert.match(result.message, /manual processes/i);
});
