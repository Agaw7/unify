const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {randomUUID}=require('node:crypto');const {PGlite}=require('@electric-sql/pglite');
test('live quoted purchase debits real product funds once and rejects changed price or reward terms',async()=>{
 const db=new PGlite(),user=randomUUID(),admin=randomUUID(),product=randomUUID();const q=async(s,a=[])=>(await db.query(s,a)).rows;
 try{
  await db.exec('create schema auth;create table auth.users(id uuid primary key,phone text);create role anon;create role authenticated;create role service_role;create table profiles(id uuid primary key references auth.users(id),role text);create table investment_products(id uuid primary key,name text,price numeric,daily_income numeric);create table team_members(id uuid primary key,invited_by uuid,created_at timestamptz default now());');
  for(const f of ['03_real_money.sql','04_payment_operations.sql','15_qrph_live_deposits.sql','16_withdrawal_only_verification.sql','17_live_withdrawal_modes.sql','18_funded_live_plans.sql','19_purchase_wallet_registration_bonus.sql','22_quoted_live_product_purchase.sql','22_quoted_live_product_purchase.sql'])await db.exec(fs.readFileSync('database/'+f,'utf8'));
  for(const id of [user,admin]){await q('insert into auth.users values($1,$2)',[id,'639123456789']);await q('insert into profiles values($1,$2)',[id,id===admin?'admin':'user']);}
  await q("insert into investment_products values($1,'Product',200,1)",[product]);
  const buy=(key=randomUUID(),price=20000,daily=100,days=365)=>q('select * from money_investment_purchase_quoted($1,$2,$3,$4,$5,$6)',[user,product,key,price,daily,days]);
  await q('begin');await q('delete from money_business_budget');await assert.rejects(buy(),/Business rewards budget is not configured/);await q('rollback');
  await assert.rejects(buy(),/Insufficient funded business rewards budget/);
  await q("select money_business_fund($1,100000,$2,'QUOTED-PURCHASE-FUND','wallet_live',100000)",[admin,randomUUID()]);
  const t=(await q("select * from money_request($1,'deposit',20000,'qrph',$2,null)",[user,randomUUID()]))[0];await q("update money_transactions set status='creating',provider_reference='cs_quote',payment_id='pay_quote' where id=$1",[t.id]);await q("select money_credit($1,'cs_quote','evt_quote',20000)",[t.id]);
  await assert.rejects(buy(),/Insufficient available balance/);await q("select money_release_hold($1,$2,'BANK-SETTLEMENT-QUOTED')",[t.id,admin]);
  await assert.rejects(buy(randomUUID(),19999),/Product terms changed/);await assert.rejects(buy(randomUUID(),20000,99),/Product terms changed/);await assert.rejects(buy(randomUUID(),20000,100,364),/Valid accepted purchase terms/);
  const key=randomUUID(),receipts=await Promise.all([buy(key),buy(key)]);assert.equal(receipts[0][0].id,receipts[1][0].id);assert.equal(Number((await q("select count(*) n from money_transactions where kind='investment_purchase'"))[0].n),1);
  assert.equal(Number((await q('select deposit_available from money_wallets where user_id=$1',[user]))[0].deposit_available),0);
  await q('update investment_products set price=300,daily_income=2 where id=$1',[product]);assert.equal((await buy(key))[0].id,receipts[0][0].id);await assert.rejects(buy(randomUUID()),/Product terms changed/);await assert.rejects(buy(key,30000,200),/Plan request conflict/);
  const b=(await q('select * from money_business_budget'))[0];assert.equal(Number(b.available),63500);assert.equal(Number(b.reserved),36500);assert.equal(Number(b.sales),20000);assert.equal(Number(b.available)+Number(b.reserved)+Number(b.sales),120000);
  const names=['G5 Pro 4K Camera','UNVR 4-Bay NVR','G4 Doorbell Pro','UniFi U6 Pro AP','G5 Bullet Camera','G5 Dome Camera','G5 Flex Camera'];
  for(const name of names)await q('insert into investment_products values($1,$2,200,1)',[randomUUID(),name]);
  await db.exec(fs.readFileSync('database/25_thirty_day_product_terms.sql','utf8'));
  const offers=await q('select price,daily_income,duration_days from investment_products where name<>$1 order by price',['Product']);
  assert.deepEqual(offers.map(o=>[Number(o.price),Number(o.daily_income),o.duration_days]),[[300,30,30],[800,84,30],[1500,166,30],[3000,340,30],[5000,576,30],[8000,990,30],[15000,1992,30]]);
  assert.equal((await buy(key))[0].duration_days,365);
  const tier1=(await q('select id from investment_products where name=$1',[names[0]]))[0].id;
  const buyTier1=(days)=>q('select * from money_investment_purchase_quoted($1,$2,$3,30000,3000,$4)',[user,tier1,randomUUID(),days]);
  await assert.rejects(buyTier1(365),/Product terms changed/);
  await q("select money_business_fund($1,100000,$2,'THIRTY-DAY-FUND','wallet_live',1000000)",[admin,randomUUID()]);
  await q('update money_wallets set deposit_available=30000 where user_id=$1',[user]);
  assert.equal((await buyTier1(30))[0].duration_days,30);
  assert.equal(Number((await q('select reserved from money_business_budget'))[0].reserved),126500);
  const uplines = [randomUUID(), randomUUID(), randomUUID()];
  for (const id of uplines) {
    await q('insert into auth.users(id) values($1)', [id]);
    await q("insert into profiles values($1,'user')", [id]);
  }
  const chain = [user, ...uplines];
  for (const [index, id] of chain.entries()) {
    await q('insert into team_members(id,invited_by) values($1,$2)', [id, chain[index + 1] ?? null]);
  }
  await db.exec(fs.readFileSync('database/52_purchase_referral_commissions.sql','utf8'));
  await q("select money_business_fund($1,200000,$2,'PURCHASE-COMMISSION-FUND','wallet_live',1000000)",[admin,randomUUID()]);
  await q('update money_wallets set deposit_available=80000 where user_id=$1',[user]);
  assert.equal((await q('select * from money_referral_commissions')).length,0);
  const tierKey=randomUUID();
  const purchaseTier=()=>q('select * from money_investment_purchase_quoted($1,$2,$3,30000,3000,30)',[user,tier1,tierKey]);
  await Promise.all([purchaseTier(),purchaseTier()]);
  await q('select money_referrals_backfill()');
  const commissions=await q('select amount,status,deposit_id,purchase_id from money_referral_commissions order by level');
  assert.deepEqual(commissions.map(c=>[Number(c.amount),c.status,c.deposit_id]),[[5400,'paid',null],[900,'paid',null],[300,'paid',null]]);
  assert.equal(new Set(commissions.map(c=>c.purchase_id)).size,1);
  for (const [index,id] of uplines.entries()) {
    assert.equal(Number((await q('select available from money_wallets where user_id=$1',[id]))[0].available),[5400,900,300][index]);
  }
  await q('update money_business_budget set available=90000');
  await buyTier1(30);
  assert.equal((await q("select * from money_referral_commissions where status='pending'")).length,3);
  await q('update money_business_budget set available=6600');
  await q('select money_pay_purchase_commissions()');
  await q('select money_pay_purchase_commissions()');
  assert.equal((await q("select * from money_referral_commissions where status='paid'")).length,6);
  assert.equal(Number((await q("select count(*) n from money_ledger where action='referral_commission'"))[0].n),6);
  await db.exec(fs.readFileSync('database/58_sixty_day_market_tiers.sql','utf8'));
  const totals = await q('select daily_income * duration_days as total, duration_days from investment_products where name = any($1::text[]) order by price', [names]);
  assert.deepEqual(totals.map(tier => [tier.duration_days, Number(tier.total)]), [
    [60, 1800], [60, 5040], [60, 9960], [60, 20400], [60, 34560], [60, 59400], [60, 119520],
  ]);
  assert.equal((await purchaseTier())[0].duration_days, 30);
  await assert.rejects(buyTier1(30), /Product terms changed/);
  await q('update money_wallets set deposit_available=30000 where user_id=$1', [user]);
  await q('update money_business_budget set available=179999');
  await assert.rejects(buyTier1(60), /Insufficient funded business rewards budget/);
  await q('update money_business_budget set available=190000');
  const [budgetBefore] = await q('select reserved from money_business_budget');
  assert.equal((await buyTier1(60))[0].duration_days, 60);
  const [budgetAfter] = await q('select reserved from money_business_budget');
  assert.equal(Number(budgetAfter.reserved) - Number(budgetBefore.reserved), 180000);
  await db.exec('set role authenticated');await assert.rejects(buy(),/permission denied/);await db.exec('reset role');
 }finally{await db.close();}
});

