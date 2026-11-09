const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

test('registration bonus endpoint authenticates and stays production-locked without ledger mutation', async () => {
  const file = path.resolve('src/app/api/money/registration-bonus/route.ts');
  let authenticated = true;
  let calls = 0;
  const server = {
    MoneyError: class extends Error { constructor(message, status = 400) { super(message); this.status = status; } },
    authenticate: async () => {
      if (!authenticated) throw new server.MoneyError('Please sign in', 401);
      return { user: { id: 'trusted-user' }, db: { rpc: async () => { calls++; } } };
    },
    requireProductionApproval: () => { throw new server.MoneyError('Production processing is unauthorized', 503); },
    json: body => ({ body, status: 200 }),
    handled: async work => {
      try { return await work(); }
      catch (error) { return { body: { error: error.message }, status: error.status }; }
    },
  };
  const loaded = new Module(file, module);
  loaded.filename = file;
  loaded.paths = module.paths;
  const original = loaded.require.bind(loaded);
  loaded.require = name => name === '@/lib/money-server' ? server : original(name);
  loaded._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, file);

  const request = { json: async () => ({ userId: 'forged-user' }) };
  authenticated = false;
  assert.equal((await loaded.exports.POST(request)).status, 401);
  authenticated = true;
  const response = await loaded.exports.POST(request);
  assert.equal(response.status, 503);
  assert.equal(calls, 0);
});
