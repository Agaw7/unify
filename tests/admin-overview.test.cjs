const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

function route(role = 'admin', failedTable) {
  const calls = [];
  const admin = {
    auth: { admin: { getUserById: async () => ({ data: { user: { phone: '09123456789' } } }) } },
    from(table) {
      calls.push(table);
      assert.ok(['profiles', 'payment_transactions', 'withdrawal_requests', 'sandbox_withdrawal_requests'].includes(table));
      const query = {
        select: () => query, eq: () => query, order: () => query,
        single: async () => ({ data: { role }, error: null }),
        limit: async () => ({
          data: table === 'profiles' ? [] : [{ id: table, user_id: 'member', amount: 200 }],
          error: table === failedTable ? { message: 'Database unavailable' } : null,
        }),
      };
      return query;
    },
  };
  const file = path.join(__dirname, '../src/app/api/admin/overview/route.ts');
  const loaded = new Module(file, module);
  loaded.filename = file;
  loaded.paths = module.paths;
  const original = loaded.require.bind(loaded);
  loaded.require = name => name === '@supabase/supabase-js' ? {
    createClient: (_url, key) => key === 'anon-test'
      ? { auth: { getUser: async () => ({ data: { user: { id: 'administrator' } }, error: null }) } }
      : admin,
  } : original(name);
  loaded._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, file);
  return { api: loaded.exports, calls };
}

test('admin overview loads payments without an investments table and keeps phones masked', async () => {
  const keys = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
  const previous = keys.map(key => process.env[key]);
  keys.forEach((key, index) => { process.env[key] = ['https://test.example', 'anon-test', 'service-test'][index]; });
  try {
    const request = { headers: new Headers({ authorization: 'Bearer test' }) };
    const { api, calls } = route();
    const response = await api.GET(request);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.transactions.length, 1);
    assert.equal(body.withdrawals.length, 2);
    assert.ok(body.withdrawals.some(w => w.id === 'sandbox_withdrawal_requests' && w.source === 'sandbox'));
    assert.equal(body.transactions[0].member_phone, '0912****789');
    assert.equal(calls.includes('investments'), false);

    assert.equal((await api.GET({ headers: new Headers() })).status, 401);
    const denied = route('member');
    assert.equal((await denied.api.GET(request)).status, 403);
    assert.deepEqual(denied.calls, ['profiles']);

    const failed = route('admin', 'payment_transactions');
    assert.equal((await failed.api.GET(request)).status, 500);
  } finally {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  }
});
