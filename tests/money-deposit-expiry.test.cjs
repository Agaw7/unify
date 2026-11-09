const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

test('checkout replacement endpoint is retired without touching ledger records', async () => {
  const file = path.resolve('src/app/api/payments/deposit/change-wallet/route.ts');
  const loaded = new Module(file, module);
  loaded.filename = file;
  loaded.paths = module.paths;
  loaded.require = name => name === 'next/server'
    ? { NextResponse: { json: (body, init) => Response.json(body, init) } }
    : module.require(name);
  loaded._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, file);
  const response = loaded.exports.POST();
  assert.equal(response.status, 404);
  assert.match((await response.json()).error, /automated checkout is unavailable/i);
});
