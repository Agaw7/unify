const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function load(relative) {
  const file = path.resolve(relative);
  const loaded = new Module(file, module);
  loaded.filename = file;
  const original = loaded.require.bind(loaded);
  loaded.require = name => name === 'next/server'
    ? { NextResponse: { json: (body, init) => Response.json(body, init) } }
    : original(name);
  loaded._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, file);
  return loaded.exports;
}

test('sandbox transaction, withdrawal, and test payment APIs stay disabled regardless of environment flags', async () => {
  const routes = [
    ['src/app/api/sandbox/manual/route.ts', ['GET', 'POST']],
    ['src/app/api/sandbox/deposit/route.ts', ['POST']],
    ['src/app/api/sandbox/withdraw/route.ts', ['POST']],
    ['src/app/api/sandbox/claims/route.ts', ['GET']],
    ['src/app/api/sandbox/claims/claims/route.ts', ['POST']],
    ['src/app/api/sandbox/claims/claim/route.ts', ['POST']],
    ['src/app/api/admin/sandbox-withdrawals/[id]/route.ts', ['POST']],
    ['src/app/api/admin/withdraw/[id]/simulate-complete/route.ts', ['POST']],
    ['src/app/api/admin/deposit/[id]/verify/route.ts', ['POST']],
    ['src/app/api/admin/deposit/[id]/delete/route.ts', ['DELETE']],
    ['src/app/api/admin/withdrawal-settings/route.ts', ['GET', 'POST']],
    ['src/app/api/withdrawals/sandbox/route.ts', ['GET']],
    ['src/app/api/payments/webhook/route.ts', ['POST']],
    ['src/app/api/payments/webhooks/paymongo/route.ts', ['POST']],
    ['src/app/payments/deposits/route.ts', ['POST']],
  ];
  const names = ['MANUAL_SANDBOX_ENABLED', 'UNIFY_SANDBOX_PAYOUTS_ENABLED', 'UNIFY_SANDBOX_CLAIMS_ENABLED'];
  const previous = names.map(name => process.env[name]);
  try {
    names.forEach(name => { process.env[name] = 'true'; });
    for (const [file, methods] of routes) {
      const api = load(file);
      for (const method of methods) {
        const response = await api[method]();
        assert.equal(response.status, 404, `${file} ${method} should be retired`);
      }
    }
  } finally {
    names.forEach((name, index) => previous[index] === undefined
      ? delete process.env[name]
      : process.env[name] = previous[index]);
  }
});
