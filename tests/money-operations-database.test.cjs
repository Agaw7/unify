const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');

test('payment operations migration, holds, verification, refunds and disputes',async t=>{
 const db=new PGlite(),user=randomUUID(),admin=randomUUID(),sender=randomUUID();
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const call=async(name,args)=>(await q(`select * from ${name}(${args.map((_,i)=>`$${i+1}`).join(',')})`,args))[0];
 const balance=async()=>(await q('select * from money_wallets where user_id=$1',[user]))[0];
 const evidence='provider-report-case-123';
 let destination,deposit,refund;
 const verify=async(kind,destinationId=null)=>{
  const v=(await q('insert into money_verifications(user_id,kind,destination_id) values($1,$2,$3) returning id',[user,kind,destinationId]))[0];
  await call('money_verification_decide',[v.id,admin,'approved','approved-process',evidence,new Date(Date.now()+86400000).toISOString(),destinationId ? 'ABCDEFGH' : null]);return v.id;
 };
 const paid=async(amount)=>{
  const d=await call('money_request',[user,'deposit',amount,'gcash',randomUUID(),null]);
  const checkout=`cs_${d.id.replaceAll('-','')}`,payment=`pay_${d.id.replaceAll('-','')}`;
  await q("update money_transactions set status='creating',provider_reference=$2,payment_id=$3 where id=$1",[d.id,checkout,payment]);
  await call('money_credit',[d.id,checkout,`evt_${d.id}`,amount]);return d;
 };
 try {
  await db.exec("create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;create table profiles(id uuid primary key references auth.users(id),role text);");
  for(const file of ['03_real_money.sql','04_payment_operations.sql']) await db.exec(fs.readFileSync(path.join(__dirname,'../database',file),'utf8'));
  for(const id of [user,admin,sender]) await q('insert into auth.users values($1)',[id]);
  for(const id of [admin,sender]) await q("insert into profiles values($1,'admin')",[id]);
  await call('money_compliance',[admin,user,true,false,null,null,evidence]);
  destination=(await q("insert into money_destinations(user_id,method,account_name,account_number) values($1,'gcash','Customer','09123456789') returning id",[user]))[0].id;
  await t.test('legacy verified flags cannot bypass current identity review',async()=>{
   await assert.rejects(call('money_request',[user,'deposit',20000,'gcash',randomUUID(),null]),/Current identity/);
   await verify('identity');await verify('ownership',destination);
   deposit=await paid(50000);
   assert.equal(Number((await balance()).available),0);
   assert.equal(Number((await balance()).held),50000);
  });
  await t.test('paid deposits remain held and replayed webhooks do not add money',async()=>{
   const tx=(await q('select * from money_transactions where id=$1',[deposit.id]))[0];
   await call('money_credit',[deposit.id,tx.provider_reference,'evt_replay',50000]);
   assert.equal(Number((await balance()).held),50000);
   await assert.rejects(call('money_request',[user,'withdrawal',10000,'gcash',randomUUID(),destination]),/Insufficient available balance/);
   await assert.rejects(call('money_release_hold',[deposit.id,admin,'']),/evidence/);
  });
  await t.test('refund reservation preserves holds; independent submit and failure return exactly once',async()=>{
   const key=randomUUID();
   refund=await call('money_adjustment_open',[deposit.id,'refund',10000,key,null,admin,evidence]);
   assert.equal((await call('money_adjustment_open',[deposit.id,'refund',10000,key,null,admin,evidence])).id,refund.id);
   assert.equal(Number((await balance()).held),40000);assert.equal(Number((await balance()).reserved),10000);
   await assert.rejects(call('money_release_hold',[deposit.id,admin,evidence]),/Active refund/);
   await assert.rejects(call('money_claim_refund',[refund.id,admin]),/Independent refund sender/);
   await call('money_claim_refund',[refund.id,sender]);
   await assert.rejects(call('money_claim_refund',[refund.id,sender]),/already claimed/);
   await q("update money_adjustments set provider_reference='ref_failed' where id=$1",[refund.id]);
   await call('money_adjustment_finish',[refund.id,'ref_failed','failed',100]);
   await call('money_adjustment_finish',[refund.id,'ref_failed','failed',100]);
   assert.equal(Number((await balance()).held),50000);assert.equal(Number((await balance()).reserved),0);
  });
  await t.test('only unsubmitted refunds may be cancelled and their reservation is restored',async()=>{
   const pending=await call('money_adjustment_open',[deposit.id,'refund',5000,randomUUID(),null,admin,evidence]);
   assert.equal(Number((await balance()).held),45000);
   await call('money_cancel_refund',[pending.id,sender,evidence]);
   assert.equal(Number((await balance()).held),50000);
   assert.equal(Number((await balance()).reserved),0);
   await assert.rejects(call('money_cancel_refund',[pending.id,sender,evidence]),/Only an unsubmitted/);
  });
  await t.test('partial succeeded refund consumes only its reserve; settlement release is idempotent',async()=>{
   refund=await call('money_adjustment_open',[deposit.id,'refund',10000,randomUUID(),null,admin,evidence]);
   await call('money_claim_refund',[refund.id,sender]);
   await q("update money_adjustments set provider_reference='ref_success' where id=$1",[refund.id]);
   await call('money_adjustment_finish',[refund.id,'ref_success','succeeded',100]);
   await call('money_adjustment_finish',[refund.id,'ref_success','succeeded',100]);
   assert.equal(Number((await balance()).held),40000);assert.equal(Number((await balance()).reserved),0);
   await assert.rejects(call('money_adjustment_open',[deposit.id,'refund',50000,randomUUID(),null,admin,evidence]),/exceeds/);
   await call('money_release_hold',[deposit.id,admin,evidence]);
   await call('money_release_hold',[deposit.id,admin,evidence]);
   assert.equal(Number((await balance()).held),0);assert.equal(Number((await balance()).available),40000);
  });
  let withdrawal;
  await t.test('a dispute freezes funds without taking money from an in-flight payout',async()=>{
   withdrawal=await call('money_request',[user,'withdrawal',30000,'gcash',randomUUID(),destination]);
   await call('money_review',[withdrawal.id,admin,'approve',evidence]);
   await call('money_claim_payout',[withdrawal.id,sender]);
   const d=await call('money_adjustment_open',[deposit.id,'dispute',20000,null,'dsp_example',null,'Signed provider dispute']);
   assert.equal(Number(d.shortfall),10000);
   assert.equal(Number((await balance()).available),0);
   assert.equal(Number((await balance()).reserved),40000);
   assert.equal(Number((await balance()).debt),10000);
   await assert.rejects(call('money_request',[user,'withdrawal',10000,'gcash',randomUUID(),destination]),/Insufficient available balance|Current identity/);
   await call('money_adjustment_finish',[d.id,'dsp_example','won',200]);
   await call('money_adjustment_finish',[d.id,'dsp_example','open',100]);
   assert.equal(Number((await balance()).available),10000);
   assert.equal(Number((await balance()).debt),0);
   assert.equal(Number((await balance()).reserved),30000);
   await q("update money_transactions set provider_reference='tr_paid' where id=$1",[withdrawal.id]);
   await call('money_settle',[withdrawal.id,'tr_paid','succeeded']);
  });
  await t.test('debt repaid from settlement is restored if the dispute is later won',async()=>{
   const next=await paid(20000);
   const d=await call('money_adjustment_open',[deposit.id,'dispute',20000,null,'dsp_second',null,'Signed provider dispute']);
   assert.equal(Number((await balance()).debt),10000);
   await call('money_alert_resolve',[`adjustment:${d.id}`,admin,evidence]);
   await call('money_release_hold',[next.id,admin,evidence]);
   assert.equal(Number((await balance()).debt),0);
   assert.equal(Number((await balance()).available),10000);
   await call('money_adjustment_finish',[d.id,'dsp_second','won',300]);
   assert.equal(Number((await balance()).available),30000);
   assert.equal(Number((await balance()).debt),0);
  });
  await t.test('ownership changes and expiry invalidate eligibility',async()=>{
   await q("update money_destinations set account_number='09999999999' where id=$1",[destination]);
   await assert.rejects(call('money_request',[user,'withdrawal',10000,'gcash',randomUUID(),destination]),/Verified destination/);
   assert.equal((await q("select status from money_verifications where destination_id=$1",[destination]))[0].status,'expired');
   await q("update money_verifications set expires_at=now()-interval '1 second' where user_id=$1 and kind='identity'",[user]);
   await assert.rejects(paid(20000),/Current identity/);
  });
  await t.test('worker leases prevent overlap and client roles cannot execute operations',async()=>{
   assert.equal((await call('money_job_claim',['test',randomUUID()])).money_job_claim,true);
   assert.equal((await call('money_job_claim',['test',randomUUID()])).money_job_claim,false);
   await db.exec('set role authenticated');
   await assert.rejects(q('select * from money_adjustments'),/permission denied/);
   await assert.rejects(call('money_release_hold',[deposit.id,admin,evidence]),/permission denied/);
   await db.exec('reset role');
   assert.equal((await q("select has_table_privilege('service_role','money_ledger','UPDATE') allowed"))[0].allowed,false);
   assert.equal((await q("select has_table_privilege('service_role','money_audit','DELETE') allowed"))[0].allowed,false);
  });
  await t.test('wallet buckets equal the sum of every immutable ledger movement',async()=>{
   const sums=(await q('select sum(available_delta) available,sum(reserved_delta) reserved,sum(held_delta) held,sum(debt_delta) debt from money_ledger where user_id=$1',[user]))[0];
   const w=await balance();
   for(const bucket of ['available','reserved','held','debt']) assert.equal(Number(w[bucket]),Number(sums[bucket]),bucket);
  });
 } finally {await db.close();}
});
