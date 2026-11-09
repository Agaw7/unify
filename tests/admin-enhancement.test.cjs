const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const ts=require('typescript');
const {randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');

function load(file, mocks={}) {
  file=path.resolve(file); const m=new Module(file,module);m.filename=file;m.paths=module.paths;
  const original=m.require.bind(m);
  m.require=name=>name in mocks?mocks[name]:original(name);
  m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file);
  return m.exports;
}

test('admin reports and readiness deny anonymous and non-admin access before reading data',async()=>{
  for(const file of ['src/app/api/admin/member-overview/route.ts','src/app/api/admin/payment-settings/route.ts']){
    let reads=0;
    for(const status of [401,403]){
      const handler=load(file,{'next/server':{},'@/lib/active-auth-users':{},'@/lib/payment-readiness':{},'@/lib/money-server':{
        authenticate:async(_r,role)=>{assert.equal(role,'role-only');throw Object.assign(Error('Denied'),{status});},
        handled:async f=>{try{return await f();}catch(e){return {status:e.status};}},
        database:()=>{reads++;},
      }});
      assert.equal((await handler.GET({})).status,status);
    }
    assert.equal(reads,0);
  }
});

test('all-true environment flags cannot override independent approval lock',async()=>{
  const readiness=load('src/lib/payment-readiness.ts');
  const server=load('src/lib/money-server.ts',{'next/server':{NextResponse:{}},'./payment-readiness':readiness,'./money-validation':{},'./withdrawal-fee':{}});
  const flags=['LIVE_PAYMENTS_ENABLED','LIVE_PAYOUTS_ENABLED','MANUAL_PALAWAN_DEPOSITS_ENABLED'];
  const previous=flags.map(k=>process.env[k]);
  try{
    flags.forEach(k=>process.env[k]='true');
    assert.throws(()=>server.requireProductionApproval(),e=>e.status===503);
    assert.throws(()=>server.liveConfig(),e=>e.status===503);
    await assert.rejects(server.rpc('money_credit_due_tier_rewards',{}),e=>e.status===503);
    await assert.rejects(server.rpc('money_referrals_backfill',{}),e=>e.status===503);
    for (const endpoint of ['/v2/checkout_sessions','/v2/batch_transfers','/refunds']) {
      await assert.rejects(server.provider(endpoint,{}),e=>e.status===503);
    }
  }finally{flags.forEach((k,i)=>previous[i]===undefined?delete process.env[k]:process.env[k]=previous[i]);}
});

test('member reporting reads beyond one page, excludes test balances and emails',async()=>{
  const profiles=Array.from({length:501},(_,i)=>({id:'member-'+i,role:'user',created_at:'2026-11-07'}));
  const auth=new Map(profiles.map(p=>[p.id,{phone:'0915000'+p.id.slice(7).padStart(4,'0'),email:'private@example.test'}]));
  const data={profiles,team_members:[{id:'member-1',invited_by:'member-0'}],manual_test_wallets:[{user_id:'member-0',available:12300,reserved:700}],
    manual_test_requests:[{id:'test-1',user_id:'member-1',kind:'deposit',amount:30000,status:'approved'}],
    sandbox_free_plan_grants:[],money_investments:[],money_transactions:[{id:'live-1',user_id:'member-0',kind:'deposit',amount:99999,status:'completed'}],money_referral_commissions:[],manual_test_audit:[],money_wallets:[{user_id:'member-0',available:10000,deposit_available:20000,reserved:3000,held:4000}]};
  const pages=[];
  const db={from(table){let offset=0,end=499;return {
    select(){return this;},order(){return this;},range(start,finish){offset=start;end=finish;pages.push([table,start]);return this;},limit(){return this;},
    then(resolve){return Promise.resolve({data:data[table].slice(offset,end+1),error:null}).then(resolve);},
  };}};
  const handler=load('src/app/api/admin/member-overview/route.ts',{'next/server':{},'@/lib/active-auth-users':{activeAuthUsers:async()=>auth},'@/lib/money-server':{
    authenticate:async()=>({db}),handled:f=>f(),json:v=>v,MoneyError:Error,
  }});
  const result=await handler.GET({nextUrl:new URL('https://example.test?member=member-0')});
  assert.equal(result.summary.members,501);assert.equal(Object.hasOwn(result.summary,'testWallets'),false);
  assert.equal(Object.hasOwn(result.summary,'approvedInviteTestDeposits'),false);
  assert.equal(result.summary.recordedWallets,37000);
  assert.equal(result.summary.recordedDeposits,99999);
  assert.equal(result.members[0].recordedBalance,37000);
  assert.equal(result.recent.find(r=>r.id==='live-1').source,'historical');
  assert.equal(result.recent.some(r=>r.id==='test-1'),false);
  assert.equal(result.detail.tests,undefined);
  assert.ok(!pages.some(([table])=>['manual_test_wallets','manual_test_requests'].includes(table)));
  assert.equal(result.detail.historical[0].amount,99999);
  assert.equal(result.detailMember,'member-0');
  assert.ok(pages.some(([table,offset])=>table==='profiles'&&offset===500));
  assert.ok(!JSON.stringify(result).includes('private@example.test'));
});

test('sandbox reviews support under-review and reversal once, preserve live records, and keep history immutable',async()=>{
  const db=new PGlite();
  try{
    await db.exec(`create schema auth;create schema storage;create role anon;create role authenticated;create role service_role;
      create table auth.users(id uuid primary key,email text,phone text,deleted_at timestamptz);
      create table profiles(id uuid primary key,role text);
      create table storage.buckets(id text,name text,public boolean,file_size_limit integer,allowed_mime_types text[]);
      create table money_wallets(available bigint);insert into money_wallets values(12345);`);
    for(const file of ['38_manual_sandbox','43_payment_readiness_reviews','44_sandbox_review_states'])await db.exec(fs.readFileSync('database/'+file+'.sql','utf8'));
    const member=randomUUID(),admin=randomUUID();
    await db.query('insert into auth.users(id) values($1),($2)',[member,admin]);
    await db.query("insert into profiles values($1,'user'),($2,'admin')",[member,admin]);
    await db.exec("update manual_test_settings set enabled=true,account_name='Test only'");
    const submit=async ref=>(await db.query("select manual_test_submit($1,$2,'deposit',30000,$3,null,null,null) id",[member,randomUUID(),ref])).rows[0].id;
    const review=(id,action,actor=admin)=>db.query('select manual_test_review($1,$2,$3,null,$4,true)',[actor,id,action,'Independent test review']);
    const id=await submit('REVIEW-0001');
    await review(id,'under_review');
    assert.equal((await db.query('select count(*)::int n from manual_test_wallets')).rows[0].n,0);
    await Promise.all([review(id,'approved'),review(id,'approved')]);
    assert.equal((await db.query('select available from manual_test_wallets')).rows[0].available,30000);
    await review(id,'reversed');await review(id,'reversed');
    assert.equal((await db.query('select available from manual_test_wallets')).rows[0].available,0);
    assert.equal((await db.query('select count(*)::int n from manual_test_ledger')).rows[0].n,2);
    const duplicate=await submit('REVIEW-0001');
    await assert.rejects(review(duplicate,'approved'),/duplicate key/);
    await assert.rejects(review(duplicate,'approved',member),/Administrator required/);
    await review(duplicate,'rejected');
    assert.equal((await db.query('select available from money_wallets')).rows[0].available,12345);
    await db.exec('set role service_role');
    await db.query('select * from payment_readiness_reviews');
    await assert.rejects(db.exec("insert into payment_readiness_reviews(approval_type,status,evidence_reference,reviewer_reference) values('merchant','submitted','TEST-EVIDENCE','TEST-REVIEWER')"),/permission denied/);
    await db.exec('reset role');
    await db.exec("insert into payment_readiness_reviews(approval_type,status,evidence_reference,reviewer_reference) values('merchant','submitted','TEST-EVIDENCE','TEST-REVIEWER')");
    await assert.rejects(db.exec("update payment_readiness_reviews set status='independently_verified'"),/append-only/);
    await db.exec('set role authenticated');
    await assert.rejects(db.query('select * from payment_readiness_reviews'),/permission denied/);
  }finally{await db.close();}
});
