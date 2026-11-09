const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

test('real money migration and atomic lifecycle',async t=>{
  const db=new PGlite();
  const user=randomUUID(), admin=randomUUID(), sender=randomUUID(), other=randomUUID(), daily=randomUUID();
  const query=async(sql,args=[]) => (await db.query(sql,args)).rows;
  const rpc=async(name,args) => (await query(`select * from public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')})`,args))[0];
  const wallet=async()=>(await query('select * from money_wallets where user_id=$1',[user]))[0];
  const compliance=async(id,verified=true,blocked=false)=>rpc('money_compliance',[admin,id,verified,blocked,null,null,'review-case-123']);
  const request=async(kind,amount,key=randomUUID(),destination=null,customer=user)=>rpc('money_request',[customer,kind,amount,'gcash',key,destination]);
  try {
    await db.exec(`create schema auth; create table auth.users(id uuid primary key);
      create role anon; create role authenticated; create role service_role;
      create table public.profiles(id uuid primary key references auth.users(id), role text);`);
    await db.exec(fs.readFileSync(path.join(__dirname,'../database/03_real_money.sql'),'utf8'));
    for(const id of [user,admin,sender,other,daily]) await query('insert into auth.users values($1)',[id]);
    for(const id of [admin,sender]) await query("insert into profiles values($1,'admin')",[id]);
    await compliance(user);await compliance(other);await compliance(daily);
    const destination=(await query("insert into money_destinations(user_id,method,account_name,account_number) values($1,'gcash','Customer Name','09123456789') returning id",[user]))[0].id;
    await rpc('money_compliance',[admin,user,true,false,destination,'ABCDEFGH','ownership-case-123']);

    await t.test('client roles cannot read/write tables or execute money mutations',async()=>{
      await db.exec('set role authenticated');
      await assert.rejects(query('select * from money_wallets'),/permission denied/);
      await assert.rejects(query('update money_customers set verified=true'),/permission denied/);
      await assert.rejects(request('deposit',20000),/permission denied/);
      await db.exec('reset role');
      const result=await query("select has_function_privilege('anon','public.money_credit(uuid,text,text,bigint)','execute') allowed");
      assert.equal(result[0].allowed,false);
    });
    let deposit;
    await t.test('deposit request is idempotent and rejects a changed payload',async()=>{
      const key=randomUUID();deposit=await request('deposit',20000,key);
      assert.equal((await request('deposit',20000,key)).id,deposit.id);
      await assert.rejects(request('deposit',30000,key),/Idempotency key conflict/);
      assert.equal(Number((await wallet()).available),0);
      await assert.rejects(request('withdrawal',10000,randomUUID(),destination),/Insufficient available balance/);
    });
    await t.test('amount mismatch cannot credit; concurrent/repeated confirmations credit once',async()=>{
      await query("update money_transactions set status='creating',provider_reference='cs_paid' where id=$1",[deposit.id]);
      await assert.rejects(rpc('money_credit',[deposit.id,'cs_paid','evt_bad',1]),/Deposit mismatch/);
      await assert.rejects(rpc('money_credit',[deposit.id,'cs_wrong','evt_bad',20000]),/Deposit mismatch/);
      await Promise.all([rpc('money_credit',[deposit.id,'cs_paid','evt_paid',20000]),rpc('money_credit',[deposit.id,'cs_paid','evt_paid',20000])]);
      await rpc('money_credit',[deposit.id,'cs_paid','evt_paid_another_delivery',20000]);
      assert.equal(Number((await wallet()).available),20000);
      assert.equal(Number((await query("select count(*) n from money_ledger where action='deposit'"))[0].n),1);
    });
    let withdrawal;
    await t.test('withdrawals atomically reserve available funds and cannot overspend',async()=>{
      const key=randomUUID();withdrawal=await request('withdrawal',15000,key,destination);
      assert.equal((await request('withdrawal',15000,key,destination)).id,withdrawal.id);
      assert.equal(Number((await wallet()).available),5000);
      assert.equal(Number((await wallet()).reserved),15000);
      await assert.rejects(request('withdrawal',10000,randomUUID(),destination),/Insufficient available balance/);
      assert.equal(Number((await wallet()).available),5000);
    });
    await t.test('payout requires independent administrators and rechecks restrictions',async()=>{
      await assert.rejects(rpc('money_review',[withdrawal.id,user,'approve','review']),/Administrator required/);
      await rpc('money_review',[withdrawal.id,admin,'approve','review-case-456']);
      await assert.rejects(rpc('money_claim_payout',[withdrawal.id,admin]),/Independent payout administrator/);
      await compliance(user,true,true);
      await assert.rejects(rpc('money_claim_payout',[withdrawal.id,sender]),/restricted/);
      await compliance(user);
      await rpc('money_claim_payout',[withdrawal.id,sender]);
      await assert.rejects(rpc('money_claim_payout',[withdrawal.id,sender]),/already claimed/);
      await assert.rejects(rpc('money_review',[withdrawal.id,admin,'reject','timeout']),/Invalid review state/);
      assert.equal(Number((await wallet()).reserved),15000);
    });
    await t.test('pending/unknown payout stays reserved; failed payout releases exactly once',async()=>{
      await query("update money_transactions set provider_reference='tr_failed' where id=$1",[withdrawal.id]);
      await assert.rejects(rpc('money_settle',[withdrawal.id,'tr_wrong','succeeded']),/Payout mismatch/);
      await rpc('money_settle',[withdrawal.id,'tr_failed','pending']);
      assert.equal(Number((await wallet()).reserved),15000);
      await rpc('money_settle',[withdrawal.id,'tr_failed','failed']);
      await rpc('money_settle',[withdrawal.id,'tr_failed','failed']);
      assert.equal(Number((await wallet()).available),20000);
      assert.equal(Number((await wallet()).reserved),0);
      await assert.rejects(rpc('money_settle',[withdrawal.id,'tr_failed','succeeded']),/Conflicting terminal/);
    });
    await t.test('successful payout consumes reserve once; rejection returns funds',async()=>{
      const w=await request('withdrawal',10000,randomUUID(),destination);
      await rpc('money_review',[w.id,admin,'approve','review-case-789']);
      await rpc('money_claim_payout',[w.id,sender]);
      await query("update money_transactions set provider_reference='tr_success' where id=$1",[w.id]);
      await rpc('money_settle',[w.id,'tr_success','succeeded']);
      await rpc('money_settle',[w.id,'tr_success','succeeded']);
      assert.equal(Number((await wallet()).available),10000);
      assert.equal(Number((await wallet()).reserved),0);
      const rejected=await request('withdrawal',10000,randomUUID(),destination);
      await rpc('money_review',[rejected.id,admin,'reject','review-case-reject']);
      assert.equal(Number((await wallet()).available),10000);
      assert.equal(Number((await wallet()).reserved),0);
    });
    await t.test('hourly and daily limits and customer restrictions apply on the server',async()=>{
      for(let i=0;i<10;i++) await request('deposit',20000,randomUUID(),null,other);
      await assert.rejects(request('deposit',20000,randomUUID(),null,other),/Hourly request limit/);
      await request('deposit',5000000,randomUUID(),null,daily);
      await request('deposit',5000000,randomUUID(),null,daily);
      await assert.rejects(request('deposit',20000,randomUUID(),null,daily),/Daily amount limit/);
      await compliance(user,true,true);
      await assert.rejects(request('deposit',20000),/Verified, unrestricted customer/);
      assert.ok(Number((await query('select count(*) n from money_audit'))[0].n)>0);
    });
  } finally { await db.close(); }
});
