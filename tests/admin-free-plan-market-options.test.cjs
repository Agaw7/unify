/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

test('FreePlan choices match the products shown in Market and include their durations', async () => {
  const file = path.resolve('src/app/api/admin/free-plans/route.ts');
  const moduleUnderTest = new Module(file, module);
  moduleUnderTest.filename = file;
  moduleUnderTest.paths = module.paths;
  const originalRequire = moduleUnderTest.require.bind(moduleUnderTest);
  const products = [
    { id: 'flex', name: 'G5 Flex Camera', price: 700, daily_income: 7, duration_days: 365 },
    { id: 'gateway', name: 'UDM Pro Gateway', price: 100, daily_income: 1, duration_days: 365 },
    { id: 'matcha', name: 'G5 Pro 4K Camera', price: 100, daily_income: 1, duration_days: 180 },
  ];
  moduleUnderTest.require = name => {
    if (name === 'next/server') return {};
    if (name === '@/lib/money-server') return {
      MoneyError: class MoneyError extends Error {},
      authenticate: async () => ({
        user: { id: 'admin' },
        db: {
          from(table) {
            const query = { filters: {} };
            const builder = {
              select() { return builder; },
              order() { return builder; },
              limit() { return builder; },
              eq(column, value) { query.filters[column] = value; return builder; },
              async single() { return { data: { role: 'admin' }, error: null }; },
              then(resolve, reject) {
                const data = table === 'investment_products' ? products : [];
                return Promise.resolve({ data, error: null }).then(resolve, reject);
              },
            };
            return builder;
          },
        },
      }),
      handled: callback => callback(),
      json: body => body,
    };
    if (name === '@/lib/money-validation') return {
      record: value => value,
      uuid: value => typeof value === 'string',
    };
    if (name === '@/lib/product-presentation') return {
      isCatalogProduct: name => name !== 'UDM Pro Gateway',
      productDetails: name => ({ 'G5 Pro 4K Camera': { tier: 1 }, 'G5 Flex Camera': { tier: 7 } })[name],
    };
    return originalRequire(name);
  };
  moduleUnderTest._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, file);

  const request = { nextUrl: { searchParams: new URLSearchParams() } };
  const result = await moduleUnderTest.exports.GET(request);
  assert.deepEqual(result.products.map(product => product.id), ['matcha', 'flex']);
  assert.equal(result.products[0].duration_days, 180);
});
