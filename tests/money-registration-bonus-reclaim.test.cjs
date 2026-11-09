const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {randomUUID}=require('node:crypto');const {PGlite}=require('@electric-sql/pglite');
test('admin reclaim returns only a provably unspent unqualified bonus, once, and protects deposits, identity and earnings',async()=>{
 const db=new PGlite(),admin=randomUUID(),member=randomUUID(),depositor=randomUUID(),verified=randomUUID(),spent=randomUUID(),referral=randomUUID(),product=randomUUID();const q=async(s,a=[])=>(await db.query(s,a)).rows;
 const reclaim=(user,actor=admin,key=randomUUID())=>q('select money_registration_bonus_reclaim($1,$2,$3,$4) id',[actor,user,key,'No deposit or approved identity; unspent bonus review']);
 try{
  await db.exec('create schema auth;create table auth.users(id uuid primary key,phone text);create role anon;create role authenticated;create role service_role;create table profiles(id uuid primary key references auth.users(id),role text);create table investment_products(id uuid primary key,name text,price numeric,daily_income numeric);create table team_members(id uuid primary key,invited_by uuid,created_at timestamptz default now());');
  for(const f of ['03_real_money.sql','04_payment_operations.sql','15_qrph_live_deposits.sql','16_withdrawal_only_verification.sql','17_live_withdrawal_modes.sql','18_funded_live_plans.sql','19_purchase_wallet_registration_bonus.sql'])await db.exec(fs.readFileSync('database/'+f,'utf8'));
  await q('insert into auth.users values($1,$2)',[admin,'639157471830']);await q("insert into profiles values($1,'admin')",[admin]);
  for(const f of ['20_automatic_registration_bonus.sql','21_registration_bonus_reclaim.sql','21_registration_bonus_reclaim.sql'])await db.exec(fs.readFileSync('database/'+f,'utf8'));
  await q("select money_business_fund($1,40000,$2,'RECLAIM-FIXTURE-FUND','wallet_live',40000)",[admin,randomUUID()]);
  for(const id of [member,depositor,verified,spent,referral]){await q('insert into auth.users values($1,$2)',[id,'639123456789']);await q("insert into profiles values($1,'user')",[id]);}
  await assert.rejects(reclaim(member,spent),/Administrator required/);
  const before=Number((await q('select available from money_business_budget'))[0].available);
  const attempts=await Promise.all([reclaim(member),reclaim(member)]);assert.equal(attempts[0][0].id,attempts[1][0].id);assert.equal(Number((await q('select available from money_wallets where user_id=$1',[member]))[0].available),0);assert.equal(Number((await q('select available from money_business_budget'))[0].available),before+3000);
  await q('select money_registration_bonus($1)',[member]);assert.equal(Number((await q('select available from money_wallets where user_id=$1',[member]))[0].available),0);
  const deposit=async(user,suffix)=>{const t=(await q("select * from money_request($1,'deposit',20000,'qrph',$2,null)",[user,randomUUID()]))[0];await q("update money_transactions set status='creating',provider_reference=$2,payment_id=$3 where id=$1",[t.id,'cs_'+suffix,'pay_'+suffix]);await q('select money_credit($1,$2,$3,20000)',[t.id,'cs_'+suffix,'evt_'+suffix]);await q("select money_release_hold($1,$2,'Actual settlement report for fixture')",[t.id,admin]);return t;};
  await deposit(depositor,'qualified');await assert.rejects(reclaim(depositor),/completed deposit or approved identity/);
  const v=(await q("insert into money_verifications(user_id,kind) values($1,'identity') returning id",[verified]))[0].id;
  await q("select money_verification_decide($1,$2,'approved','Manual review','Verified identity evidence',now()+interval '1 day',null)",[v,admin]);await q("update money_verifications set status='expired' where id=$1",[v]);await assert.rejects(reclaim(verified),/completed deposit or approved identity/);
  await q("insert into investment_products values($1,'Small funded fixture',10,0.01)",[product]);await q('select money_investment_open($1,$2,$3)',[spent,product,randomUUID()]);
  await q('insert into team_members(id,invited_by) values($1,$2)',[referral,spent]);const referralDeposit=await deposit(referral,'referral');await q('select money_referrals_process($1)',[referralDeposit.id]);
  assert.equal(Number((await q('select available from money_wallets where user_id=$1',[spent]))[0].available),8000);await assert.rejects(reclaim(spent),/spent, reserved, or has financial activity/);
  const overview=(await q('select money_registration_bonus_overview($1) result',[admin]))[0].result;assert.equal(overview.find(r=>r.user_id===member).revoked_at!==null,true);assert.equal(overview.find(r=>r.user_id===spent).can_reclaim,false);assert.equal(overview.find(r=>r.user_id===verified).has_identity,true);
  assert.equal((await q("select count(*) n from money_transactions where kind='registration_bonus_reversal'"))[0].n,1);
  const b=(await q('select * from money_business_budget'))[0],liability=Number((await q('select sum(available+deposit_available+reserved+held) n from money_wallets'))[0].n);assert.equal(Number(b.available)+Number(b.reserved)+Number(b.sales)+liability,80000);
  await db.exec('set role authenticated');await assert.rejects(reclaim(member),/permission denied/);await assert.rejects(q('select money_registration_bonus_overview($1)',[admin]),/permission denied/);await db.exec('reset role');
 }finally{await db.close();}
});
