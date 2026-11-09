const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {randomUUID}=require('node:crypto');const {PGlite}=require('@electric-sql/pglite');
test('new registration grants a funded bonus automatically, retries pending grants after funding, and excludes other old accounts',async()=>{
 const db=new PGlite(),admin='fc955312-fb86-48e6-b4d4-4163c947c2bc',old=randomUUID();const q=async(s,a=[])=>(await db.query(s,a)).rows;
 try{
  await db.exec('create schema auth;create table auth.users(id uuid primary key,phone text);create role anon;create role authenticated;create role service_role;create table profiles(id uuid primary key references auth.users(id),role text);create table investment_products(id uuid primary key,name text,price numeric,daily_income numeric);create table team_members(id uuid primary key,invited_by uuid,created_at timestamptz default now());');
  for(const f of ['03_real_money.sql','04_payment_operations.sql','15_qrph_live_deposits.sql','16_withdrawal_only_verification.sql','17_live_withdrawal_modes.sql','18_funded_live_plans.sql','19_purchase_wallet_registration_bonus.sql'])await db.exec(fs.readFileSync('database/'+f,'utf8'));
  await q('insert into auth.users values($1,$2),($3,$4)',[admin,'639157471830',old,'639123456789']);await q("insert into profiles values($1,'admin'),($2,'user')",[admin,old]);
  const migration=fs.readFileSync('database/20_automatic_registration_bonus.sql','utf8');await db.exec(migration);await db.exec(migration);
  assert.equal(Number((await q('select count(*) n from money_registration_bonus_queue'))[0].n),0);
  await q("select money_business_fund($1,20000,$2,'AUTO-BONUS-FUND-200','wallet_live',20000)",[admin,randomUUID()]);
  const members=[];for(let i=0;i<7;i++){const id=randomUUID();members.push(id);await q('insert into auth.users values($1,$2)',[id,'63910000000'+i]);}
  assert.equal(Number((await q('select count(*) n from money_registration_bonuses'))[0].n),6);assert.equal(Number((await q('select available from money_business_budget'))[0].available),2000);
  assert.equal((await q('select status from money_registration_bonus_queue where user_id=$1',[members[6]]))[0].status,'pending');assert.equal((await q('select count(*) n from auth.users'))[0].n,9);
  await q('select money_registration_bonuses_process()');assert.equal(Number((await q('select count(*) n from money_registration_bonuses'))[0].n),6);
  const enrollment=fs.readFileSync('scripts/enroll-owner-registration-bonus.sql','utf8');await db.exec(enrollment);await db.exec(enrollment);
  assert.equal((await q('select status from money_registration_bonus_queue where user_id=$1',[admin]))[0].status,'pending');assert.equal((await q('select count(*) n from money_registration_bonus_queue where user_id=$1',[old]))[0].n,0);
  await q("select money_business_fund($1,10000,$2,'AUTO-BONUS-FUND-100','wallet_live',30000)",[admin,randomUUID()]);
  assert.equal(Number((await q('select count(*) n from money_registration_bonuses'))[0].n),8);assert.equal(Number((await q('select available from money_wallets where user_id=$1',[admin]))[0].available),3000);
  const countBefore=Number((await q('select count(*) n from money_ledger'))[0].n);await Promise.all([q('select money_registration_bonuses_process()'),q('select money_registration_bonuses_process()')]);await q('select money_registration_bonus($1)',[members[0]]);assert.equal(Number((await q('select count(*) n from money_ledger'))[0].n),countBefore);
  const budget=Number((await q('select available from money_business_budget'))[0].available),liabilities=Number((await q('select sum(available+deposit_available+reserved+held) n from money_wallets'))[0].n);assert.equal(budget,6000);assert.equal(budget+liabilities,30000);
  await db.exec(fs.readFileSync('database/29_registration_bonus_twenty.sql','utf8'));
  for(let i=0;i<3;i++){
    const user=randomUUID();
    await q('insert into auth.users values($1,$2)',[user,'63920000000'+i]);
    assert.equal(Number((await q('select amount from money_registration_bonuses where user_id=$1',[user]))[0].amount),2000);
    assert.equal(Number((await q('select available from money_wallets where user_id=$1',[user]))[0].available),2000);
  }
  assert.equal(Number((await q('select available from money_business_budget'))[0].available),0);
  assert.equal(Number((await q('select amount from money_registration_bonuses where user_id=$1',[admin]))[0].amount),3000);
  await db.exec('set role authenticated');await assert.rejects(q('select money_registration_bonuses_process()'),/permission denied/);await assert.rejects(q('select * from money_registration_bonus_queue'),/permission denied/);await db.exec('reset role');
 }finally{await db.close();}
});
