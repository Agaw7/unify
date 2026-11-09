const {test}=require('node:test');const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');const fs=require('node:fs');const {PGlite}=require('@electric-sql/pglite');
test('live GCash Maya and QRPh requests remain idempotent, held and restricted to the signed-in customer',async()=>{
 const db=new PGlite(),user=randomUUID(),blocked=randomUUID();const q=async(s,a=[])=>(await db.query(s,a)).rows;
 try{
 await db.exec('create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;create table profiles(id uuid primary key,role text);');
 for(const f of ['03_real_money.sql','04_payment_operations.sql','15_qrph_live_deposits.sql','16_withdrawal_only_verification.sql','24_live_ewallet_deposits.sql','24_live_ewallet_deposits.sql'])await db.exec(fs.readFileSync('database/'+f,'utf8'));
 await q('insert into auth.users values($1),($2)',[user,blocked]);await q('insert into money_customers(user_id,blocked) values($1,true)',[blocked]);
 const request=async(method,key=randomUUID(),who=user,kind='deposit')=>(await q('select * from money_request($1,$2,20000,$3,$4,null)',[who,kind,method,key]))[0];
 for(const method of ['gcash','maya','qrph']){
  const key=randomUUID(),t=await request(method,key);assert.equal((await request(method,key)).id,t.id);
  await assert.rejects(request(method==='maya'?'gcash':'maya',key),/Idempotency/);
  await q("update money_transactions set status='creating',provider_reference=$2 where id=$1",[t.id,'cs_'+method]);
  await q('select money_credit($1,$2,$3,20000)',[t.id,'cs_'+method,'evt_'+method]);await q('select money_credit($1,$2,$3,20000)',[t.id,'cs_'+method,'evt_'+method]);
 }
 const wallet=(await q('select * from money_wallets where user_id=$1',[user]))[0];assert.equal(Number(wallet.held),60000);assert.equal(Number(wallet.available),0);
 await assert.rejects(request('card'),/Invalid/);await assert.rejects(request('gcash',randomUUID(),blocked),/restricted/);await assert.rejects(request('qrph',randomUUID(),user,'withdrawal'),/Verified/);
 await db.exec('set role authenticated');await assert.rejects(request('gcash'),/permission denied/);
 }finally{await db.close();}
});
