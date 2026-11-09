const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
const path = require('node:path');

const file = path.resolve(__dirname, '../src/lib/money-validation.ts');
const loaded = new Module(file, module);
loaded.filename = file;
loaded.paths = module.paths;
loaded._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, file);
const { centavos, record, uuid } = loaded.exports;

test('PHP amounts use exact centavos and enforce boundaries', () => {
  assert.equal(centavos(200.01, 20000), 20001);
  assert.equal(centavos(50000), 5000000);
  for (const amount of ['200', NaN, Infinity, 99.99, 50000.01, 200.001]) assert.throws(() => centavos(amount));
});

test('financial input helpers validate identifiers and plain records', () => {
  assert.equal(uuid('123e4567-e89b-42d3-a456-426614174000'), true);
  assert.equal(uuid('not-a-uuid'), false);
  assert.deepEqual(record({ amount: 100 }), { amount: 100 });
  assert.deepEqual(record(null), {});
  assert.deepEqual(record([]), {});
});
