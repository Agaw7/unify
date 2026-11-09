const {test}=require('node:test');const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');const fs=require('node:fs');const {PGlite}=require('@electric-sql/pglite');
test('team milestones count distinct paid L1 members, preserve previous claims, and enforce funding and permissions',async()=>{
 const db=new PGlite();const q=async(s,a=[])=>(await db.query(s,a)).rows;const owner=randomUUID(),other=randomUUID(),product=randomUUID();
 try{
 await db.exec('create schema auth;create table auth.users(id uuid primary key,phone text);create role anon;create role authenticated;create role service_role;create table profiles(id uuid primary key,role text);create table investment_products(id uuid primary key,name text,price numeric,daily_income numeric);create table team_members(id uuid primary key,invited_by uuid,created_at timestamptz default now());');
 for(const f of ['03_real_money.sql','04_payment_operations.sql','15_qrph_live_deposits.sql','16_withdrawal_only_verification.sql','17_live_withdrawal_modes.sql','18_funded_live_plans.sql','23_live_daily_tasks.sql','23_live_daily_tasks.sql'])await db.exec(fs.readFileSync('database/'+f,'utf8'));
 for(const id of [owner,other]){await q('insert into auth.users values($1,null)',[id]);await q("insert into profiles values($1,'user')",[id]);}
 await q("insert into investment_products values($1,'Plan',200,50)",[product]);
 const add=async(parent,acquisition='purchase',old=false)=>{const id=randomUUID();await q('insert into auth.users values($1,null)',[id]);await q('insert into team_members(id,invited_by) values($1,$2)',[id,parent]);await q("insert into money_investments(user_id,product_id,name,price,daily_amount,acquisition,idempotency_key,created_at) values($1,$2,'Plan',20000,5000,$3,$4,case when $5 then ((now() at time zone 'Asia/Manila')::date::timestamp at time zone 'Asia/Manila')-interval '1 second' else now() end)",[id,product,acquisition,randomUUID(),old]);return id;};
 const first=await add(owner);await q("insert into money_investments(user_id,product_id,name,price,daily_amount,acquisition,idempotency_key) values($1,$2,'Again',20000,5000,'purchase',$3)",[first,product,randomUUID()]);
 await add(owner,'free_plan');await add(owner,'purchase',true);await add(first);await add(other);
 assert.equal((await q('select money_daily_tasks($1) tasks',[owner]))[0].tasks[0].active_count,1);
 await assert.rejects(q('select money_daily_task_claim($1,5)',[owner]),/locked/);
 for(let i=0;i<4;i++)await add(owner);
 await assert.rejects(q('select money_daily_task_claim($1,5)',[owner]),/Insufficient funded/);
 assert.equal(Number((await q('select count(*) n from money_daily_task_claims'))[0].n),0);
 await q('update money_business_budget set available=20000,funded=20000');
 const results=await Promise.all(Array.from({length:5},()=>q('select money_daily_task_claim($1,5) result',[owner])));
 assert.equal(results.filter(r=>r[0].result.credited===5000).length,1);
 assert.equal(Number((await q('select available from money_wallets where user_id=$1',[owner]))[0].available),5000);
 assert.equal(Number((await q('select available from money_business_budget'))[0].available),15000);
 assert.equal(Number((await q("select count(*) n from money_transactions where kind='daily_task_reward'"))[0].n),1);
 assert.equal((await q('select money_daily_tasks($1) tasks',[owner]))[0].tasks[0].claimed,true);
 assert.equal((await q('select money_daily_tasks($1) tasks',[other]))[0].tasks[0].claimed,false);
 await assert.rejects(q('select money_daily_task_claim($1,7)',[owner]),/Invalid/);
 await q("update money_daily_task_claims set task_date=task_date-1 where user_id=$1",[owner]);
 await db.exec(fs.readFileSync('database/26_lifetime_team_tasks.sql','utf8'));
 const lifetime=(await q('select money_daily_tasks($1) tasks',[owner]))[0].tasks[0];
 assert.equal(lifetime.active_count,6);
 assert.equal(lifetime.claimed,true);
 assert.equal((await q('select money_daily_task_claim($1,5) result',[owner]))[0].result.credited,0);
 await db.exec(fs.readFileSync('database/27_cash_promotions.sql','utf8'));
 const claim=async(user,kind,code=null,amount=null)=>(await q('select money_claim_promo($1,$2,$3,$4) result',[user,kind,code,amount]))[0].result;
 assert.equal((await claim(owner,'check_in_reward')).amount,500);
 assert.equal((await claim(owner,'check_in_reward')).alreadyClaimed,true);
 assert.equal((await q('select money_check_in_status($1) checked',[owner]))[0].checked,true);
 const gift='a'.repeat(64), expired='b'.repeat(64);
 await q('insert into money_gift_codes(code_hash,created_by,max_claims) values($1,$2,1)',[gift,owner]);
 await q("insert into money_gift_codes(code_hash,created_by,max_claims,expires_at) values($1,$2,1,now()-interval '1 second')",[expired,owner]);
 await assert.rejects(claim(other,'gift_code_reward',expired,100),/Invalid or expired/);
 assert.equal((await claim(owner,'gift_code_reward',gift,1000)).amount,1000);
 assert.equal((await claim(owner,'gift_code_reward',gift,100)).amount,1000);
 await assert.rejects(claim(other,'gift_code_reward',gift,100),/fully claimed/);
 assert.equal(Number((await q('select available from money_business_budget'))[0].available),13500);
 await db.exec('set role authenticated');await assert.rejects(q('select money_daily_task_claim($1,5)',[owner]),/permission denied/);await assert.rejects(q('select * from money_daily_task_claims'),/permission denied/);
 }finally{await db.close();}
});
