const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
test('rejection refunds exactly once, preserves paid withdrawals, and requires admin service access',async()=>{
 const db=new PGlite();
 const admin='11111111-1111-4111-8111-111111111111',user='22222222-2222-4222-8222-222222222222';
 const ids=[3,4,5,6].map(n=>`${n}3333333-3333-4333-8333-333333333333`);
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;
   create table profiles(id uuid primary key,role text);
   create table sandbox_wallets(user_id uuid primary key,remaining_balance numeric);
   create table sandbox_withdrawal_requests(id uuid primary key,user_id uuid,amount numeric,status text);
   insert into profiles values('${admin}','admin'),('${user}','user');
   insert into sandbox_wallets values('${user}',500);
   insert into sandbox_withdrawal_requests values('${ids[0]}','${user}',200,'reserved'),
    ('${ids[1]}','${user}',100,'processing'),('${ids[2]}','${user}',300,'simulated_paid'),
    ('${ids[3]}','${admin}',50,'reserved');`);
  const migration=fs.readFileSync(path.join(__dirname,'../database/14_reject_sandbox_withdrawals.sql'),'utf8');
  await db.exec(migration); await db.exec(migration);
  const reject=async(id,actor=admin,reason='Invalid account')=>(await db.query('select reject_sandbox_withdrawal($1,$2,$3) result',[actor,id,reason])).rows[0].result;
  await db.exec('set role authenticated');await assert.rejects(reject(ids[0]),/permission denied/);
  await db.exec('reset role;set role service_role');
  await assert.rejects(reject(ids[0],user),/Administrator required/);
  await assert.rejects(reject(ids[0],admin,' '),/rejection reason/);
  assert.equal((await reject(ids[0])).replayed,false);
  assert.equal((await reject(ids[0])).replayed,true);
  assert.equal((await reject(ids[1])).status,'rejected');
  await assert.rejects(reject(ids[2]),/Only unpaid/);
  await assert.rejects(reject(ids[3]),/wallet not found/);
  await db.exec('reset role');
  assert.equal(Number((await db.query('select remaining_balance from sandbox_wallets')).rows[0].remaining_balance),800);
  const row=(await db.query('select * from sandbox_withdrawal_requests where id=$1',[ids[0]])).rows[0];
  assert.equal(row.rejection_reason,'Invalid account');assert.equal(row.rejected_by,admin);assert.ok(row.rejected_at);
  assert.equal((await db.query('select status from sandbox_withdrawal_requests where id=$1',[ids[3]])).rows[0].status,'reserved');
 }finally{await db.close();}
});
