const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

test('manual sandbox isolates funds, prevents duplicate credits, and finalizes or returns reservations once', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create schema auth; create schema storage;
      create role anon; create role authenticated; create role service_role;
      create table auth.users(id uuid primary key,email text,phone text,deleted_at timestamptz);
      create table public.profiles(id uuid primary key, role text);
      create table storage.buckets(id text,name text,public boolean,file_size_limit integer,allowed_mime_types text[]);
      create table public.money_wallets(available bigint);
      insert into public.money_wallets values(50000);`);
    await db.exec(readFileSync('database/38_manual_sandbox.sql', 'utf8'));
    const [member, admin, other] = Array.from({ length: 3 }, () => randomUUID());
    const q = async (sql, params) => (await db.query(sql, params)).rows;
    await q('insert into auth.users(id) values ($1),($2),($3)', [member,admin,other]);
    await q("insert into profiles values ($1,'user'),($2,'admin'),($3,'user')", [member,admin,other]);
    const submit = async (kind, amount, key = randomUUID(), user = member, ref = 'TEST-DEP-1') => (
      await q('select manual_test_submit($1,$2,$3,$4,$5,null,$6,$7) id', [
        user,key,kind,amount,kind === 'deposit' ? ref : null,
        kind === 'withdrawal' ? 'Test recipient' : null,kind === 'withdrawal' ? '00000000' : null,
      ])
    )[0].id;
    const review = (id, action, { actor = admin, ref = null, reason = null, confirm = true } = {}) =>
      q('select manual_test_review($1,$2,$3,$4,$5,$6)', [actor,id,action,ref,reason,confirm]);
    const wallet = async () => (await q('select available,reserved from manual_test_wallets where user_id=$1',[member]))[0];

    await assert.rejects(submit('deposit',30000), /disabled/);
    await db.exec("update manual_test_settings set enabled=true,account_name='Sandbox test';");
    const key = randomUUID();
    const deposit = await submit('deposit',30000,key);
    assert.equal(await submit('deposit',30000,key),deposit);
    await assert.rejects(submit('deposit',29000,key),/details changed/);
    assert.equal((await q('select status from manual_test_requests where id=$1',[deposit]))[0].status,'pending');
    assert.equal(await wallet(),undefined);
    await assert.rejects(review(deposit,'approved',{actor:member}),/Administrator required/);
    await assert.rejects(review(deposit,'approved',{confirm:false}),/confirmation required/);
    await Promise.all([review(deposit,'approved'),review(deposit,'approved')]);
    assert.deepEqual(await wallet(),{available:30000,reserved:0});
    assert.equal((await q("select count(*)::int n from manual_test_ledger where request_id=$1",[deposit]))[0].n,1);
    const duplicate = await submit('deposit',30000,randomUUID(),other);
    await assert.rejects(review(duplicate,'approved'),/duplicate key/);
    await review(duplicate,'rejected',{reason:'Reference already reviewed'});
    assert.equal((await q('select count(*)::int n from manual_test_wallets where user_id=$1',[other]))[0].n,0);

    const withdrawal = await submit('withdrawal',20000);
    assert.deepEqual(await wallet(),{available:10000,reserved:20000});
    await assert.rejects(submit('withdrawal',10001),/Insufficient test balance/);
    await review(withdrawal,'approved');
    await review(withdrawal,'processing');
    await assert.rejects(review(withdrawal,'completed'),/reference and confirmation required/);
    await review(withdrawal,'completed',{ref:'TEST-OUT-1'});
    await review(withdrawal,'completed',{ref:'TEST-OUT-1'});
    assert.deepEqual(await wallet(),{available:10000,reserved:0});
    const rejected = await submit('withdrawal',10000);
    await review(rejected,'rejected',{reason:'Rejected in test'});
    await review(rejected,'rejected',{reason:'Rejected in test'});
    const failed = await submit('withdrawal',10000);
    await review(failed,'approved');
    await review(failed,'processing');
    await review(failed,'failed',{reason:'Simulated failure'});
    await review(failed,'failed',{reason:'Simulated failure'});
    assert.deepEqual(await wallet(),{available:10000,reserved:0});

    const [{ manual_test_admin_overview: view }] = await q("select manual_test_admin_overview($1,'',0)",[admin]);
    assert.equal(view.members.length,3);
    assert.equal(view.summary.wallet,10000);
    assert.equal(view.summary.approvedDeposits,30000);
    assert.equal(view.summary.completedWithdrawals,20000);
    assert.equal((await q('select available from money_wallets'))[0].available,50000);
    await db.exec('set role authenticated;');
    await assert.rejects(q('select * from manual_test_requests'),/permission denied/);
    await assert.rejects(review(deposit,'approved'),/permission denied/);
  } finally {
    await db.close();
  }
});
