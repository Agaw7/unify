const {test}=require('node:test');const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');const fs=require('node:fs');const {PGlite}=require('@electric-sql/pglite');
test('purchase-only deposits, funded once-only registration bonus, refunds and liability conservation',async()=>{
 const db=new PGlite(),user=randomUUID(),admin=randomUUID(),other=randomUUID(),product=randomUUID();
 const q=async(s,a=[])=>(await db.query(s,a)).rows;
 const wallet=async()=>(await q('select * from money_wallets where user_id=$1',[user]))[0];
 try{
  await db.exec('create schema auth;create table auth.users(id uuid primary key,phone text);create role anon;create role authenticated;create role service_role;create table profiles(id uuid primary key references auth.users(id),role text);create table investment_products(id uuid primary key,name text,price numeric,daily_income numeric);create table team_members(id uuid primary key,invited_by uuid,created_at timestamptz default now());');
  for(const f of ['03_real_money.sql','04_payment_operations.sql','15_qrph_live_deposits.sql','16_withdrawal_only_verification.sql','17_live_withdrawal_modes.sql','18_funded_live_plans.sql','19_purchase_wallet_registration_bonus.sql','19_purchase_wallet_registration_bonus.sql'])await db.exec(fs.readFileSync('database/'+f,'utf8'));
  for(const id of [user,admin,other]){await q('insert into auth.users values($1,$2)',[id,'639123456789']);await q('insert into profiles values($1,$2)',[id,id===admin?'admin':'user']);}
  await assert.rejects(q('select money_registration_bonus($1)',[user]),/awaiting business funding/);
  assert.equal(Number((await q('select count(*) n from money_transactions'))[0].n),0);
  await q("select money_business_fund($1,20000,$2,'BUSINESS-TOPUP-200','wallet_live',20000)",[admin,randomUUID()]);
  const grants=await Promise.all([q('select money_registration_bonus($1) id',[user]),q('select money_registration_bonus($1) id',[user])]);
  assert.equal(grants[0][0].id,grants[1][0].id);assert.equal(Number((await wallet()).available),3000);assert.equal(Number((await q('select available from money_business_budget'))[0].available),17000);
  await q("insert into money_verifications(user_id,kind,status,expires_at) values($1,'identity','approved',now()+interval '1 day')",[user]);
  const dest=(await q("insert into money_destinations(user_id,method,account_name,account_number,bic,verified) values($1,'gcash','Test User','09123456789','GLOPPHM2XXX',true) returning id",[user]))[0].id;
  await q("insert into money_verifications(user_id,destination_id,kind,status,expires_at) values($1,$2,'ownership','approved',now()+interval '1 day')",[user,dest]);
  const deposit=(await q("select * from money_request($1,'deposit',20000,'qrph',$2,null)",[user,randomUUID()]))[0];
  await q("update money_transactions set status='creating',provider_reference='cs_purchase',payment_id='pay_purchase' where id=$1",[deposit.id]);await q("select money_credit($1,'cs_purchase','evt_purchase',20000)",[deposit.id]);
  assert.equal(Number((await wallet()).deposit_available),0);assert.equal(Number((await wallet()).held),20000);
  await q("select money_release_hold($1,$2,'BANK-SETTLEMENT-200')",[deposit.id,admin]);await q("select money_release_hold($1,$2,'BANK-SETTLEMENT-200')",[deposit.id,admin]);
  assert.equal(Number((await wallet()).available),3000);assert.equal(Number((await wallet()).deposit_available),20000);
  await q('update money_customers set verified=true where user_id=$1',[user]);
  await assert.rejects(q("select money_request($1,'withdrawal',10000,'gcash',$2,$3)",[user,randomUUID(),dest]),/Insufficient available balance/);
  const adjustment=(await q("select * from money_adjustment_open($1,'refund',5000,$2,null,$3,'Customer refund test')",[deposit.id,randomUUID(),admin]))[0];
  assert.equal(Number(adjustment.deposit_part),5000);assert.equal(Number((await wallet()).available),3000);assert.equal(Number((await wallet()).deposit_available),15000);
  await q("select money_adjustment_finish($1,null,'failed',1)",[adjustment.id]);await q("select money_adjustment_finish($1,null,'failed',1)",[adjustment.id]);assert.equal(Number((await wallet()).deposit_available),20000);
  const dispute=(await q("select * from money_adjustment_open($1,'dispute',5000,null,'dsp_purchase',null,'Signed dispute test')",[deposit.id]))[0];
  await q("select money_adjustment_finish($1,'dsp_purchase','won',1)",[dispute.id]);assert.equal(Number((await wallet()).deposit_available),20000);
  // This fixture uses a small, fully funded daily reward obligation.
  await q("insert into investment_products values($1,'Product',200,0.1)",[product]);
  const key=randomUUID(),inv=(await q('select * from money_investment_open($1,$2,$3)',[user,product,key]))[0];
  assert.equal((await q('select * from money_investment_open($1,$2,$3)',[user,product,key]))[0].id,inv.id);assert.equal(Number((await wallet()).deposit_available),0);assert.equal(Number((await wallet()).available),3000);
  await assert.rejects(q("select money_business_fund($1,10000,$2,'DUPLICATE-ALLOCATION','wallet_live',40000)",[admin,randomUUID()]),/Insufficient unallocated/);
  const b=(await q('select * from money_business_budget'))[0],w=await wallet();assert.equal(Number(b.available)+Number(b.reserved)+Number(b.sales)+Number(w.available)+Number(w.deposit_available)+Number(w.reserved)+Number(w.held),40000);
  const ledger=(await q('select sum(available_delta) a,sum(deposit_delta) d,sum(reserved_delta) r,sum(held_delta) h from money_ledger where user_id=$1',[user]))[0];for(const [column,alias] of [['available','a'],['deposit_available','d'],['reserved','r'],['held','h']])assert.equal(Number(w[column]),Number(ledger[alias]));
  const later=(await q("select * from money_request($1,'deposit',20000,'qrph',$2,null)",[user,randomUUID()]))[0];
  await q("update money_transactions set status='creating',provider_reference='cs_debt',payment_id='pay_debt' where id=$1",[later.id]);
  const debt=(await q("select * from money_adjustment_open($1,'dispute',20000,null,'dsp_debt',null,'Verified dispute against spent deposit')",[deposit.id]))[0];
  assert.equal(Number((await wallet()).debt),17000);
  await q("select money_credit($1,'cs_debt','evt_debt',20000)",[later.id]);
  await q("select money_alert_resolve($1,$2,'Reviewed bank evidence for debt recovery')",['adjustment:'+debt.id,admin]);
  await q("select money_release_hold($1,$2,'BANK-DEBT-RECOVERY-REPORT')",[later.id,admin]);
  assert.equal(Number((await wallet()).deposit_available),3000);assert.equal(Number((await wallet()).debt),0);
  await q("select money_adjustment_finish($1,'dsp_debt','won',1)",[debt.id]);
  assert.equal(Number((await wallet()).deposit_available),20000);assert.equal(Number((await wallet()).available),3000);
  const refund=(await q("select * from money_adjustment_open($1,'refund',5000,$2,null,$3,'Confirmed product deposit refund')",[deposit.id,randomUUID(),admin]))[0];
  await q("select money_adjustment_finish($1,null,'succeeded',1)",[refund.id]);assert.equal(Number((await wallet()).deposit_available),15000);assert.equal(Number((await wallet()).available),3000);
  await db.exec(fs.readFileSync('database/19_purchase_wallet_registration_bonus.sql','utf8'));
  const final=await wallet(),deltas=(await q('select sum(available_delta) a,sum(deposit_delta) d,sum(reserved_delta) r,sum(held_delta) h,sum(debt_delta) debt from money_ledger where user_id=$1',[user]))[0];
  for(const [column,alias] of [['available','a'],['deposit_available','d'],['reserved','r'],['held','h'],['debt','debt']])assert.equal(Number(final[column]),Number(deltas[alias]));
  await db.exec('set role authenticated');await assert.rejects(q('select money_registration_bonus($1)',[other]),/permission denied/);await assert.rejects(q('update money_wallets set deposit_available=1'),/permission denied/);await assert.rejects(q('select * from money_registration_bonuses'),/permission denied/);await db.exec('reset role');
 }finally{await db.close();}
});
