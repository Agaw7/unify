const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
test('combined test purchases support either wallet, split exact amounts, and roll back failures',async()=>{
 const db=new PGlite();
 try {
  await db.exec(`create role anon; create role authenticated; create schema auth;
   create function auth.uid() returns uuid language sql as $$select '11111111-1111-4111-8111-111111111111'::uuid$$;
   create table wallet_accounts(user_id uuid primary key,balance numeric check(balance>=0),currency text default 'PHP');
   create table sandbox_wallets(user_id uuid primary key,remaining_balance numeric check(remaining_balance>=0),currency text default 'PHP');
   create table investment_products(id uuid primary key,price numeric,daily_income numeric);
   create table demo_investments(id uuid primary key default gen_random_uuid(),user_id uuid,product_id uuid,amount numeric,daily_income numeric check(daily_income>=0));
   insert into investment_products values('33333333-3333-4333-8333-333333333333',200,50);
   insert into wallet_accounts values(auth.uid(),500,'PHP'),('22222222-2222-4222-8222-222222222222',900,'PHP');
   insert into sandbox_wallets values(auth.uid(),50,'PHP');`);
  await db.exec(fs.readFileSync(path.join(__dirname,'../database/06_combined_sandbox_purchase.sql'),'utf8'));
  const buy=amount=>db.query(`select purchase_demo_investment('33333333-3333-4333-8333-333333333333',$1)`,[amount]);
  const balances=async()=>[Number((await db.query('select remaining_balance from sandbox_wallets where user_id=auth.uid()')).rows[0].remaining_balance),Number((await db.query('select balance from wallet_accounts where user_id=auth.uid()')).rows[0].balance)];
  await assert.rejects(buy(100),/does not match/);
  await buy(200);assert.deepEqual(await balances(),[0,350]);
  await buy(200);assert.deepEqual(await balances(),[0,150]);
  await assert.rejects(buy(200),/Insufficient combined/);assert.deepEqual(await balances(),[0,150]);
  await db.exec('update sandbox_wallets set remaining_balance=100');
  await db.exec('update investment_products set daily_income=-1');
  await assert.rejects(buy(200));assert.deepEqual(await balances(),[100,150]);
  await db.exec('update investment_products set daily_income=50; update sandbox_wallets set remaining_balance=200; update wallet_accounts set balance=0 where user_id=auth.uid()');
  await buy(200);assert.deepEqual(await balances(),[0,0]);
  assert.equal(Number((await db.query("select balance from wallet_accounts where user_id<>auth.uid()")).rows[0].balance),900);
  assert.equal(Number((await db.query('select count(*) from demo_investments')).rows[0].count),3);
 } finally {await db.close();}
});
