const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

test('product purchase debits only the authenticated remaining balance and rolls back failed purchases', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.customer_id',true),'')::uuid $$;
      create table sandbox_wallets(user_id uuid primary key,remaining_balance numeric check(remaining_balance>=0),currency text default 'PHP');
      create table wallet_accounts(user_id uuid primary key,balance numeric);
      create table investment_products(id uuid primary key,price numeric,daily_income numeric);
      create table demo_investments(id uuid primary key default gen_random_uuid(),user_id uuid,product_id uuid,amount numeric,daily_income numeric check(daily_income>=0));
      insert into sandbox_wallets values('11111111-1111-4111-8111-111111111111',500,'PHP'),('22222222-2222-4222-8222-222222222222',800,'PHP');
      insert into wallet_accounts values('11111111-1111-4111-8111-111111111111',0);
      insert into investment_products values('33333333-3333-4333-8333-333333333333',200,50);
    `);
    await db.exec(fs.readFileSync(path.join(__dirname,'../database/05_sandbox_purchase_balance.sql'),'utf8'));
    const buy = amount => db.query(`select purchase_demo_investment('33333333-3333-4333-8333-333333333333',$1)`, [amount]);
    await assert.rejects(buy(200), /Authentication required/);
    await db.exec(`set test.customer_id='11111111-1111-4111-8111-111111111111'`);
    await assert.rejects(buy(100), /does not match/);
    await buy(200);
    const wallet = await db.query('select remaining_balance from sandbox_wallets order by user_id');
    assert.deepEqual(wallet.rows.map(r=>Number(r.remaining_balance)),[300,800]);
    assert.equal(Number((await db.query('select balance from wallet_accounts')).rows[0].balance),0);
    await db.exec('update investment_products set daily_income=-1');
    await assert.rejects(buy(200));
    assert.equal(Number((await db.query("select remaining_balance from sandbox_wallets where user_id=auth.uid()")).rows[0].remaining_balance),300);
    await db.exec('update investment_products set daily_income=50');
    await buy(200);
    await assert.rejects(buy(200), /Insufficient Remaining Balance/);
    assert.equal(Number((await db.query('select count(*) from demo_investments')).rows[0].count),2);
  } finally { await db.close(); }
});

