const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

test('sandbox withdrawal admin endpoint stays unavailable even when test payout flags are enabled', async () => {
  const file = path.resolve('src/app/api/admin/sandbox-withdrawals/[id]/route.ts');
  const loaded = new Module(file, module);
  loaded.filename = file;
  const original = loaded.require.bind(loaded);
  loaded.require = name => name === 'next/server'
    ? { NextResponse: { json: (body, init) => Response.json(body, init) } }
    : original(name);
  loaded._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, file);

  const previous = [process.env.UNIFY_SANDBOX_PAYOUTS_ENABLED, process.env.PAYMONGO_SECRET_KEY];
  process.env.UNIFY_SANDBOX_PAYOUTS_ENABLED = 'true';
  process.env.PAYMONGO_SECRET_KEY = 'sk_test_example';
  try {
    const response = await loaded.exports.POST();
    assert.equal(response.status, 404);
    assert.match((await response.json()).error, /no longer available/i);
  } finally {
    ['UNIFY_SANDBOX_PAYOUTS_ENABLED', 'PAYMONGO_SECRET_KEY'].forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  }
});
