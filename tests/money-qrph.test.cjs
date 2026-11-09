const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
test('live QRPh deposits are scoped, repeat-safe, held for settlement and unavailable as a payout method',async()=>{
 const db=new PGlite(),user=randomUUID(),admin=randomUUID();
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const request=async(method,key=randomUUID(),kind='deposit',amount=20000)=>(await q('select * from money_request($1,$2,$3,$4,$5,null)',[user,kind,amount,method,key]))[0];
 try{
  await db.exec('create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;create table profiles(id uuid primary key references auth.users(id),role text);');
  for(const file of ['03_real_money.sql','04_payment_operations.sql','15_qrph_live_deposits.sql','15_qrph_live_deposits.sql']) await db.exec(fs.readFileSync(`database/${file}`,'utf8'));
  await q('insert into auth.users values($1),($2)',[user,admin]);
  await q("insert into profiles values($1,'admin')",[admin]);
  await q('insert into money_customers(user_id,verified) values($1,true)',[user]);
  await assert.rejects(request('qrph'),/Current identity/);
  await q("insert into money_verifications(user_id,kind,status,expires_at) values($1,'identity','approved',now()+interval '1 day')",[user]);
  await db.exec('set role authenticated');await assert.rejects(request('qrph'),/permission denied/);await db.exec('reset role');
  const key=randomUUID(),tx=await request('qrph',key);
  assert.equal((await request('qrph',key)).id,tx.id);
  await assert.rejects(request('qrph',key,'deposit',30000),/Idempotency key conflict/);
  await assert.rejects(request('gcash'),/Invalid money request/);
  await assert.rejects(request('qrph',randomUUID(),'withdrawal'),/Invalid money request/);
  await q("update money_transactions set status='creating',provider_reference='cs_qrph',payment_id='pay_qrph' where id=$1",[tx.id]);
  await q("select money_credit($1,'cs_qrph','evt_qrph',20000)",[tx.id]);
  await q("select money_credit($1,'cs_qrph','evt_qrph',20000)",[tx.id]);
  const wallet=(await q('select available,held from money_wallets where user_id=$1',[user]))[0];
  assert.equal(Number(wallet.available),0);assert.equal(Number(wallet.held),20000);
 }finally{await db.close();}
});
