const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {readFileSync}=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');

for (const method of ['gotyme','gcash','maya']) test(`manual ${method} consumes or releases reservation once with unique transfer references`,async()=>{
  const db=new PGlite();
  const [member,reviewer,sender]=Array.from({length:3},()=>randomUUID());
  const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
  try{
    await db.exec('create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;create table profiles(id uuid primary key references auth.users(id),role text);');
    for(const file of ['03_real_money','04_payment_operations','15_qrph_live_deposits','16_withdrawal_only_verification','17_live_withdrawal_modes','24_live_ewallet_deposits','33_withdrawal_fee','40_manual_gotyme_withdrawals','41_manual_wallet_withdrawals','53_manual_withdrawal_request_review']){
      await db.exec(readFileSync('database/'+file+'.sql','utf8'));
    }
    await q('insert into auth.users values($1),($2),($3)',[member,reviewer,sender]);
    await q("insert into profiles values($1,'admin'),($2,'admin')",[reviewer,sender]);
    await q('insert into money_customers(user_id,verified) values($1,true)',[member]);
    await q('insert into money_wallets(user_id,available) values($1,100000)',[member]);
    const destination=(await q("insert into money_destinations(user_id,method,account_name,account_number,bic,verified) values($1,$2,'Test Recipient',$3,'TESTPHM2XXX',true) returning id",[member,method,method==='gotyme'?'123456789012':'09123456789']))[0].id;
    if (method !== 'gotyme') {
      await q('update money_customers set verified=false where user_id=$1',[member]);
      await q('update money_destinations set verified=false,bic=null where id=$1',[destination]);
      const key=randomUUID();
      const request=()=>q('select * from money_request_withdrawal($1,20000,$2,$3,$4)',[member,method,key,destination]);
      await q("update money_settings set withdrawal_mode='automatic'");
      await assert.rejects(request(),/Verified, unrestricted customer required/);
      await q("update money_settings set withdrawal_mode='admin_approval'");
      const [pending]=await request();
      assert.equal(pending.status,'reserved');
      assert.equal((await request())[0].id,pending.id);
      assert.deepEqual((await q('select available,reserved from money_wallets where user_id=$1',[member]))[0],{available:80000,reserved:20000});
      await q("select money_review($1,$2,'approve','Reviewed request')",[pending.id,reviewer]);
      await assert.rejects(q('select money_claim_payout($1,$2)',[pending.id,sender]),/restricted/);
      await q("select money_review($1,$2,'reject','Verification incomplete')",[pending.id,reviewer]);
      assert.deepEqual((await q('select available,reserved from money_wallets where user_id=$1',[member]))[0],{available:100000,reserved:0});
      await q('update money_customers set verified=true where user_id=$1',[member]);
      await q("update money_destinations set verified=true,bic='TESTPHM2XXX' where id=$1",[destination]);
    }
    await q("insert into money_verifications(user_id,kind,status,expires_at) values($1,'identity','approved',now()+interval '1 day')",[member]);
    await q("insert into money_verifications(user_id,kind,destination_id,status,expires_at) values($1,'ownership',$2,'approved',now()+interval '1 day')",[member,destination]);
    const request=async()=> (await q("select * from money_request_withdrawal($1,20000,$4,$2,$3)",[member,randomUUID(),destination,method]))[0];
    const finish=(id,ref,status,actor=sender)=>q('select money_record_manual_gotyme($1,$2,$3,$4,true)',[id,actor,ref,status]);
    const first=await request();
    assert.equal(Number(first.withdrawal_fee),1000);
    await assert.rejects(finish(first.id,'MANUAL-1','succeeded'),/claimed/);
    await q("select money_review($1,$2,'approve','Ownership checked')",[first.id,reviewer]);
    await assert.rejects(q('select money_claim_payout($1,$2)',[first.id,reviewer]),/Independent/);
    await q('select money_claim_payout($1,$2)',[first.id,sender]);
    await assert.rejects(finish(first.id,'MANUAL-1','succeeded',member),/Independent/);
    await finish(first.id,'MANUAL-1','succeeded');
    await finish(first.id,'MANUAL-1','succeeded');
    await assert.rejects(finish(first.id,'MANUAL-2','succeeded'),/different transfer/);
    const second=await request();
    await q("select money_review($1,$2,'approve','Ownership checked')",[second.id,reviewer]);
    await q('select money_claim_payout($1,$2)',[second.id,sender]);
    await assert.rejects(finish(second.id,'MANUAL-1','succeeded'),/duplicate key/);
    await finish(second.id,'MANUAL-FAILED','failed');
    await finish(second.id,'MANUAL-FAILED','failed');
    assert.deepEqual((await q('select available,reserved from money_wallets where user_id=$1',[member]))[0],{available:80000,reserved:0});
    await db.exec('set role authenticated');
    await assert.rejects(finish(first.id,'MANUAL-1','succeeded'),/permission denied/);
  }finally{await db.close();}
});
