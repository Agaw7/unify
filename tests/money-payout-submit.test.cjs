const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

test('payout action is hard-locked before any transfer or database mutation', async () => {
  const file = path.resolve('src/app/api/admin/money/route.ts');
  const loaded = new Module(file, module);
  loaded.filename = file;
  loaded.paths = module.paths;
  class MoneyError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
  const server = {
    MoneyError,
    authenticate: async () => ({ db: {}, user: { id: 'admin' } }),
    handled: async work => {
      try { return await work(); }
      catch (error) { return Response.json({ error: error.message }, { status: error.status ?? 500 }); }
    },
    json: body => Response.json(body),
    requireProductionApproval: () => { throw new MoneyError('Production processing is unauthorized', 503); },
    rpc: async () => { throw new Error('RPC must not be called'); },
  };
  const original = loaded.require.bind(loaded);
  loaded.require = name => name === 'next/server'
    ? {}
    : name === '@/lib/money-server'
      ? server
      : name === '@/lib/money-validation'
        ? { record: value => value && typeof value === 'object' ? value : {}, uuid: () => true }
        : original(name);
  loaded._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, file);

  const originalFetch = global.fetch;
  let requests = 0;
  global.fetch = async () => { requests++; throw new Error('Unexpected transfer request'); };
  try {
    const response = await loaded.exports.POST({ json: async () => ({ action: 'payout', id: 'withdrawal' }) });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /unauthorized/i);
    assert.equal(requests, 0);
  } finally {
    global.fetch = originalFetch;
  }
});
