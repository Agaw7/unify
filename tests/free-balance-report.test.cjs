const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

test('Free Balance invite report includes only granted members and their active invite deposits', async () => {
  const file = path.resolve('src/app/api/admin/free-balance/route.ts');
  const moduleUnderTest = new Module(file, module);
  moduleUnderTest.filename = file;
  moduleUnderTest.paths = module.paths;
  const originalRequire = moduleUnderTest.require.bind(moduleUnderTest);
  const rows = {
    profiles: [
      { id: 'grant-1', role: 'user' },
      { id: 'grant-2', role: 'user' },
      { id: 'invite-active', role: 'user' },
      { id: 'invite-deleted', role: 'user' },
    ],
    team_members: [
      { id: 'invite-active', invited_by: 'grant-1' },
      { id: 'invite-deleted', invited_by: 'grant-1' },
      { id: 'grant-1', invited_by: 'grant-1' },
    ],
    grants: [
      { id: 'grant-row', user_id: 'grant-1', amount: 150000 },
    ],
    deposits: [
      { id: 'deposit-active', user_id: 'invite-active', amount: 35000 },
      { id: 'deposit-deleted', user_id: 'invite-deleted', amount: 90000 },
      { id: 'deposit-recipient', user_id: 'grant-1', amount: 110000 },
    ],
  };
  const queries = [];
  moduleUnderTest.require = name => {
    if (name === 'next/server') return {};
    if (name === '@/lib/money-server') return {
      MoneyError: class MoneyError extends Error {},
      authenticate: async () => ({
        db: {
          from(table) {
            const query = { filters: {} };
            const builder = {
              select() { return builder; },
              order() { return builder; },
              eq(column, value) { query.filters[column] = value; return builder; },
              async range() {
                queries.push({ table, filters: query.filters });
                if (table === 'money_transactions') {
                  if (query.filters.kind === 'admin_balance_grant') return { data: rows.grants, error: null };
                  if (query.filters.kind === 'deposit') return { data: rows.deposits, error: null };
                }
                return { data: rows[table], error: null };
              },
            };
            return builder;
          },
        },
      }),
      handled: async callback => callback(),
      json: body => body,
    };
    if (name === '@/lib/active-auth-users') return {
      activeAuthUsers: async () => {
        return new Map([
        ['grant-1', { id: 'grant-1', phone: '+639111111111' }],
        ['grant-2', { id: 'grant-2', phone: '+639222222222' }],
        ['invite-active', { id: 'invite-active', phone: '+639333333333' }],
        ]);
      },
    };
    if (name === '@/lib/money-validation') return {
      record: value => value && typeof value === 'object' && !Array.isArray(value) ? value : {},
      uuid: value => typeof value === 'string',
    };
    return originalRequire(name);
  };
  moduleUnderTest._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, file);

  const result = await moduleUnderTest.exports.GET();
  assert.deepEqual(queries.filter(query => query.table === 'money_transactions').map(query => query.filters.kind).sort(), ['admin_balance_grant', 'deposit']);
  assert.deepEqual(result.grantedMembers, [{
    id: 'grant-1',
    phone: '+639111111111',
    grantTotal: 150000,
    activeInvites: 1,
    inviteDepositTotal: 35000,
  }]);
});
