const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const file = path.resolve('src/lib/money-operations.ts');
const loaded = new Module(file, module);
loaded.filename = file;
loaded.paths = module.paths;
const server = { MoneyError: class extends Error { constructor(message, status = 400) { super(message); this.status = status; } } };
const original = loaded.require.bind(loaded);
loaded.require = name => name === './money-server' ? server : original(name);
loaded._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, file);

test('automated refunds, risk checks, disputes, and reconciliation fail closed without network access', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; throw new Error('Unexpected network request'); };
  try {
    for (const operation of [
      () => loaded.exports.observeRefund('external-ref'),
      () => loaded.exports.observeSignedDispute({}, Date.now()),
      () => loaded.exports.syncPaymentRisk('external-payment'),
      () => loaded.exports.submitRefund('refund', 'admin'),
    ]) await assert.rejects(operation, error => error.status === 503);
    assert.deepEqual(await loaded.exports.runReconciliation(), {
      paused: true,
      reason: 'Automated provider reconciliation is unavailable.',
    });
    assert.equal(calls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});
