const {test}=require('node:test');const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');const fs=require('node:fs');const {PGlite}=require('@electric-sql/pglite');
test('live withdrawal modes snapshot only new requests, enforce eligibility and claim once',async()=>{
 const db=new PGlite(),user=randomUUID(),admin=randomUUID(),other=randomUUID();const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 try{
 await db.exec('create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;create table profiles(id uuid primary key references auth.users(id),role text);');
 for(const f of ['03_real_money.sql','04_payment_operations.sql','15_qrph_live_deposits.sql','16_withdrawal_only_verification.sql','17_live_withdrawal_modes.sql','17_live_withdrawal_modes.sql'])await db.exec(fs.readFileSync('database/'+f,'utf8'));
 await q('insert into auth.users values($1),($2),($3)',[user,admin,other]);await q("insert into profiles values($1,'admin'),($2,'admin')",[admin,other]);
 await q('insert into money_customers(user_id,verified) values($1,true)',[user]);await q('insert into money_wallets(user_id,available) values($1,100000)',[user]);
 const dest=(await q("insert into money_destinations(user_id,method,account_name,account_number,bic,verified) values($1,'gcash','Test Person','09123456789','GLOPPHM2XXX',true) returning id",[user]))[0].id;
 await q("insert into money_verifications(user_id,kind,status,expires_at) values($1,'identity','approved',now()+interval '1 day')",[user]);await q("insert into money_verifications(user_id,kind,destination_id,status,expires_at) values($1,'ownership',$2,'approved',now()+interval '1 day')",[user,dest]);
 const request=async(key=randomUUID())=>(await q("select * from money_request($1,'withdrawal',10000,'gcash',$2,$3)",[user,key,dest]))[0];
 const old=await request();assert.equal(old.withdrawal_mode,'admin_approval');await assert.rejects(q('select money_claim_automatic_payout($1)',[old.id]),/ineligible/);
 await assert.rejects(q("select money_set_withdrawal_mode($1,'automatic','Change mode')",[user]),/Administrator/);
 await db.exec('set role authenticated');await assert.rejects(q("select * from money_settings"),/permission denied/);await assert.rejects(q("select money_set_withdrawal_mode($1,'automatic','Change mode')",[admin]),/permission denied/);await db.exec('reset role');
 await q("select money_set_withdrawal_mode($1,'automatic','Enable new eligible requests')",[admin]);const key=randomUUID(),auto=await request(key);assert.equal(auto.withdrawal_mode,'automatic');assert.equal((await request(key)).id,auto.id);
 await q("select money_set_withdrawal_mode($1,'admin_approval','Pause new automatic requests')",[admin]);assert.equal((await request()).withdrawal_mode,'admin_approval');assert.equal((await q('select withdrawal_mode from money_transactions where id=$1',[old.id]))[0].withdrawal_mode,'admin_approval');
 await q('update money_customers set blocked=true where user_id=$1',[user]);await assert.rejects(q('select money_claim_automatic_payout($1)',[auto.id]),/restricted/);await q('update money_customers set blocked=false where user_id=$1',[user]);
 await q('select money_claim_automatic_payout($1)',[auto.id]);assert.equal((await q('select status from money_transactions where id=$1',[auto.id]))[0].status,'processing');await assert.rejects(q('select money_claim_automatic_payout($1)',[auto.id]),/already claimed/);
 await q("select money_review($1,$2,'approve','Checked manual request')",[old.id,admin]);await assert.rejects(q('select money_claim_payout($1,$2)',[old.id,admin]),/Independent/);await q('select money_claim_payout($1,$2)',[old.id,other]);
 assert.equal(Number((await q("select count(*) n from money_audit where action='withdrawal_mode_changed'"))[0].n),2);
 }finally{await db.close();}
});
