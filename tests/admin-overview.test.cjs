const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

test('retired admin overview does not expose legacy sandbox reporting', async () => {
  const file = path.join(__dirname, '../src/app/api/admin/overview/route.ts');
  const route = new Module(file, module);
  route.filename = file;
  route.paths = module.paths;
  route._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, file);

  const response = await route.exports.GET();
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: 'Legacy sandbox reporting is no longer available.',
  });
});
