const {test}=require('node:test');const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');const fs=require('fs');const {PGlite}=require('@electric-sql/pglite');
test('funded live plans conserve cash, reserve full rewards, scope claims and pay settled commissions once',async()=>{
 const db=new PGlite(),user=randomUUID(),admin=randomUUID(),parent=randomUUID(),grand=randomUUID(),great=randomUUID(),product=randomUUID();const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 try{
 await db.exec('create schema auth;create table auth.users(id uuid primary key,phone text);create role anon;create role authenticated;create role service_role;create table profiles(id uuid primary key references auth.users(id),role text);create table investment_products(id uuid primary key,name text,price numeric,daily_income numeric);create table team_members(id uuid primary key,invited_by uuid,created_at timestamptz default now());');
 for(const f of ['03_real_money.sql','04_payment_operations.sql','15_qrph_live_deposits.sql','16_withdrawal_only_verification.sql','17_live_withdrawal_modes.sql','18_funded_live_plans.sql','18_funded_live_plans.sql'])await db.exec(fs.readFileSync('database/'+f,'utf8'));
 for(const id of [user,admin,parent,grand,great]){await q('insert into auth.users values($1,$2)',[id,'639123456789']);await q('insert into profiles values($1,$2)',[id,id===admin?'admin':'user']);}
 await q("insert into investment_products values($1,'Starter',200,1)",[product]);await q('insert into money_wallets(user_id,available) values($1,20000)',[user]);
 const open=async(key=randomUUID(),actor=null)=>(await q('select * from money_investment_open($1,$2,$3,$4)',[user,product,key,actor]))[0];
 assert.equal(Number((await q('select available from money_business_budget'))[0].available),0);
 await assert.rejects(open(),/Insufficient funded/);await assert.rejects(q("select money_business_fund($1,1000000,$2,'BANK-TOPUP-1','wallet_live',0)",[admin,randomUUID()]),/Insufficient unallocated/);
 const fundingKey=randomUUID();await q("select money_business_fund($1,1000000,$2,'BANK-TOPUP-1','wallet_live',1020000)",[admin,fundingKey]);await q("select money_business_fund($1,1000000,$2,'BANK-TOPUP-1','wallet_live',1020000)",[admin,fundingKey]);assert.equal(Number((await q('select funded from money_business_budget'))[0].funded),1000000);
 await assert.rejects(q("select money_business_fund($1,10000,$2,'BANK-TOPUP-2','wallet_live',1020000)",[admin,randomUUID()]),/Insufficient unallocated/);
 const key=randomUUID(),inv=await open(key);assert.equal((await open(key)).id,inv.id);assert.equal(Number((await q('select reserved from money_business_budget'))[0].reserved),36500);assert.equal(Number((await q('select available from money_wallets where user_id=$1',[user]))[0].available),0);
 assert.equal((await q('select money_investment_claim($1,$2) result',[user,inv.id]))[0].result.claimed_days,0);
 await q("update money_investments set created_at=now()-interval '23 hours 59 minutes' where id=$1",[inv.id]);
 assert.equal((await q('select money_investment_claim($1,$2) result',[user,inv.id]))[0].result.claimed_days,0);
 await q("update money_investments set created_at=now()-interval '24 hours' where id=$1",[inv.id]);
 assert.deepEqual((await q('select money_investment_claim($1,$2) result',[user,inv.id]))[0].result,{credited:100,claimed_days:1});
 assert.equal(Number((await q('select available from money_wallets where user_id=$1',[user]))[0].available),100);
 await q("update money_investments set created_at=now()-interval '2 days' where id=$1",[inv.id]);await assert.rejects(q('select money_investment_claim($1,$2)',[parent,inv.id]));const claim=(await q('select money_investment_claim($1,$2) result',[user,inv.id]))[0].result;assert.deepEqual(claim,{credited:100,claimed_days:1});assert.equal((await q('select money_investment_claim($1,$2) result',[user,inv.id]))[0].result.claimed_days,0);
 await assert.rejects(open(randomUUID(),parent),/Administrator/);await open(randomUUID(),admin);await assert.rejects(open(randomUUID(),admin),/already received/);
 await q('insert into team_members(id,invited_by) values($1,$2),($2,$3),($3,$4)',[user,parent,grand,great]);
 const tx=(await q("select * from money_request($1,'deposit',50000,'qrph',$2,null)",[user,randomUUID()]))[0];await q("update money_transactions set status='creating',provider_reference='cs_live',payment_id='pay_live' where id=$1",[tx.id]);await q("select money_credit($1,'cs_live','evt_live',50000)",[tx.id]);await q('select money_referrals_process($1)',[tx.id]);assert.equal((await q('select count(*) n from money_referral_commissions'))[0].n,0);
 await q("select money_release_hold($1,$2,'Actual settlement report BANK-REPORT-1')",[tx.id,admin]);const before=(await q('select available from money_business_budget'))[0].available;await q('update money_business_budget set available=0');await q('select money_referrals_process($1)',[tx.id]);assert.equal((await q("select count(*) n from money_referral_commissions where status='pending'"))[0].n,3);await q('update money_business_budget set available=$1',[before]);await q('select money_referrals_backfill()');await q('select money_referrals_process($1)',[tx.id]);assert.deepEqual((await q('select amount,status from money_referral_commissions order by level')).map(r=>[Number(r.amount),r.status]),[[15000,'paid'],[1000,'paid'],[500,'paid']]);
 await Promise.all(Array.from({length:5},()=>q('select money_referrals_process($1)',[tx.id])));
 assert.equal(Number((await q('select count(*) n from money_referral_commissions where deposit_id=$1',[tx.id]))[0].n),3);
 assert.equal(Number((await q("select count(*) n from money_transactions where kind='referral_commission'"))[0].n),3);
 await db.exec(fs.readFileSync('database/28_referral_tier_rates.sql','utf8'));
 const second=(await q("select * from money_request($1,'deposit',50000,'qrph',$2,null)",[user,randomUUID()]))[0];
 await q("update money_transactions set status='creating',provider_reference='cs_live_2',payment_id='pay_live_2' where id=$1",[second.id]);
 await q("select money_credit($1,'cs_live_2','evt_live_2',50000)",[second.id]);
 await q("select money_release_hold($1,$2,'Actual settlement report BANK-REPORT-2')",[second.id,admin]);
 await Promise.all(Array.from({length:5},()=>q('select money_referrals_process($1)',[second.id])));
 assert.equal(Number((await q("select count(*) n from money_transactions where kind='referral_commission'"))[0].n),6);
 assert.equal(Number((await q('select available from money_wallets where user_id=$1',[parent]))[0].available),24000);
 assert.deepEqual((await q('select amount from money_referral_commissions where deposit_id=$1 order by level',[second.id])).map(r=>Number(r.amount)),[9000,1500,500]);
 const tree=(await q('select money_live_team($1) result',[parent]))[0].result;assert.equal(tree.total_commission,24000);assert.equal(tree.levels[0].members[0].phone_last4,'6789');assert.deepEqual(tree.levels.map(tier=>tier.rate),[18,3,1]);
 const b=(await q('select * from money_business_budget'))[0],wallet=(await q('select sum(available+reserved+held) n from money_wallets'))[0];assert.equal(Number(b.available)+Number(b.reserved)+Number(b.sales)+Number(wallet.n),1120000);
 await db.exec('set role authenticated');await assert.rejects(q('select * from money_investments'),/permission denied/);await assert.rejects(q('select money_investment_claim($1,$2)',[user,inv.id]),/permission denied/);await db.exec('reset role');
 }finally{await db.close();}
});
