const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const {randomUUID}=require('node:crypto');
const ts=require('typescript');
const {PGlite}=require('@electric-sql/pglite');

test('admin can create a hashed gift code without bypassing approval on reward claims',async()=>{
  const file=path.resolve('src/app/api/rewards/route.ts'),m=new Module(file,module);
  m.filename=file;m.paths=module.paths;const req=m.require.bind(m);
  let inserted;class MoneyError extends Error{}
  m.require=n=>n==='next/server'?{}:n==='@/lib/money-validation'?{record:value=>value}:n==='@/lib/money-server'?{
    MoneyError,handled:fn=>fn(),json:value=>value,
    requireProductionApproval:()=>{throw Error('Reward claims must remain approval-gated');},
    authenticate:async(_request,mode)=>{
      assert.equal(mode,'role-only');
      return {user:{id:'admin'},db:{from:table=>({
        insert:async value=>{assert.equal(table,'money_gift_codes');inserted=value;return {error:null};},
      })}};
    },
  }:req(n);
  m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,file);
  const result=await m.exports.POST({json:async()=>({action:'create',maxClaims:3})});
  assert.match(result.code,/^A-[A-Z0-9]{6}$/);
  assert.match(inserted.code_hash,/^[0-9a-f]{64}$/);
  assert.equal(inserted.created_by,'admin');
  assert.equal(inserted.max_claims,3);
});

test('gift-code redemption accepts new codes and still accepts unexpired legacy codes',async()=>{
  const file=path.resolve('src/app/api/rewards/route.ts'),m=new Module(file,module);
  m.filename=file;m.paths=module.paths;const req=m.require.bind(m);
  class MoneyError extends Error{}
  const hashes=[];
  m.require=n=>n==='next/server'?{}:n==='@/lib/money-validation'?{record:value=>value}:n==='@/lib/money-server'?{
    MoneyError,handled:fn=>fn(),json:value=>value,requireProductionApproval:()=>{},
    authenticate:async()=>({user:{id:'member'},db:{rpc:async(_name,args)=>{
      hashes.push(args.p_code_hash);
      return {data:{amount:100},error:null};
    }}}),
  }:req(n);
  m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,file);
  for(const code of ['A-ABC234','59E636C7685CE643A1346920']){
    await m.exports.POST({json:async()=>({action:'redeem',code})});
  }
  assert.equal(hashes.length,2);
  await assert.rejects(m.exports.POST({json:async()=>({action:'redeem',code:'A-ABC23'})}),/valid gift code/);
});

test('manual-payment flag cannot bypass independent approval for cash check-in',async()=>{
  const flags=['LIVE_PAYMENTS_ENABLED','MANUAL_PALAWAN_DEPOSITS_ENABLED'];
  const old=flags.map(k=>process.env[k]);
  let calls=0;
  try{
    process.env.LIVE_PAYMENTS_ENABLED='false';process.env.MANUAL_PALAWAN_DEPOSITS_ENABLED='true';
    const file=path.resolve('src/app/api/rewards/route.ts'),m=new Module(file,module);
    m.filename=file;m.paths=module.paths;const req=m.require.bind(m);
    class MoneyError extends Error{}
    m.require=n=>n==='next/server'?{}:n==='@/lib/money-validation'?{record:v=>v}:n==='@/lib/money-server'?{
      MoneyError,handled:f=>f(),json:v=>v,
      requireProductionApproval:()=>{throw Error('Independent approval required');},
      liveConfig:()=>{throw Error('Gateway must not be called');},
      authenticate:async()=>({user:{id:'member'},db:{rpc:async(name,args)=>{
        assert.equal(name,'money_claim_promo');assert.equal(args.p_kind,'check_in_reward');calls++;
        return {data:{amount:500,alreadyClaimed:false},error:null};
      }}}),
    }:req(n);
    m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,file);
    await assert.rejects(m.exports.POST({json:async()=>({action:'check-in'})}),/Independent approval required/);
    process.env.MANUAL_PALAWAN_DEPOSITS_ENABLED='false';
    await assert.rejects(m.exports.POST({json:async()=>({action:'check-in'})}),/Independent approval required/);
    assert.equal(calls,0);
  }finally{flags.forEach((k,i)=>{if(old[i]===undefined)delete process.env[k];else process.env[k]=old[i];});}
});

test('daily check-in credits PHP5 once and rejects an unfunded claim',async()=>{
  const db=new PGlite();
  try{
    await db.exec(`create schema auth;create table auth.users(id uuid primary key,phone text);
      create role anon;create role authenticated;create role service_role;
      create table profiles(id uuid primary key references auth.users(id),role text);
      create table investment_products(id uuid primary key,name text,price numeric,daily_income numeric);
      create table team_members(id uuid primary key,invited_by uuid,created_at timestamptz default now());`);
    for(const name of ['03_real_money','04_payment_operations','15_qrph_live_deposits','16_withdrawal_only_verification','17_live_withdrawal_modes','18_funded_live_plans','27_cash_promotions','47_gift_code_expiry_5_minutes','48_withdrawable_free_balance_grants'])await db.exec(fs.readFileSync(`database/${name}.sql`,'utf8'));
    const admin=randomUUID();
    await db.query('insert into auth.users(id) values($1)',[admin]);
    const codeExpiry=await db.query("insert into money_gift_codes(code_hash,created_by,max_claims) values(repeat('a',64),$1,1) returning extract(epoch from (expires_at-now()))*1000 as lifetime",[admin]);
    assert.ok(Number(codeExpiry.rows[0].lifetime)>=4*60*1000 && Number(codeExpiry.rows[0].lifetime)<=5*60*1000);
    const first=randomUUID(),second=randomUUID();
    await db.query('insert into auth.users(id) values($1),($2)',[first,second]);
    await db.exec('update money_business_budget set available=500 where id=true');
    const claim=id=>db.query("select money_claim_promo($1,'check_in_reward') as result",[id]);
    assert.equal((await claim(first)).rows[0].result.amount,500);
    assert.equal((await claim(first)).rows[0].result.alreadyClaimed,true);
    assert.equal((await db.query('select available from money_wallets where user_id=$1',[first])).rows[0].available,500);
    await assert.rejects(claim(second),/Insufficient funded business rewards budget/);
    assert.equal((await db.query("select count(*)::int n from money_transactions where kind='check_in_reward'")).rows[0].n,1);
    const third=randomUUID();
    await db.query('insert into auth.users(id) values($1)',[third]);
    await db.query('insert into profiles(id,role) values($1,$2),($3,$4),($5,$6)',[first,'admin',second,'user',third,'user']);
    await db.exec('update money_business_budget set available=200000 where id=true');
    const key=randomUUID();
    const grant=(users,amount=100000,idempotencyKey=key)=>db.query(
      'select money_admin_grant_balance($1,$2,$3,$4,$5) as result',
      [first,users,amount,idempotencyKey,'promotional test grant'],
    );
    assert.deepEqual((await grant([second])).rows[0].result,{alreadyGranted:false,count:1,amount:100000});
    assert.deepEqual((await grant([second])).rows[0].result,{alreadyGranted:true,count:1,amount:100000});
    assert.equal((await db.query('select available from money_wallets where user_id=$1',[second])).rows[0].available,100000);
    assert.equal((await db.query('select available from money_business_budget where id=true')).rows[0].available,100000);
    await db.exec('update money_business_budget set available=150000 where id=true');
    await assert.rejects(grant([second,third],100000,randomUUID()),/Insufficient funded business rewards budget/);
    assert.equal((await db.query('select count(*)::int n from money_transactions where kind=$1',[ 'admin_balance_grant' ])).rows[0].n,1);
    assert.equal((await db.query('select available from money_wallets where user_id=$1',[third])).rows[0]?.available ?? 0,0);
  }finally{await db.close();}
});

test('manual-payment tasks cannot bypass independent approval for cash rewards',async()=>{
  const flags=['LIVE_PAYMENTS_ENABLED','MANUAL_PALAWAN_DEPOSITS_ENABLED'];
  const old=flags.map(k=>process.env[k]);let claims=0;
  try{
    process.env.LIVE_PAYMENTS_ENABLED='false';process.env.MANUAL_PALAWAN_DEPOSITS_ENABLED='true';
    const file=path.resolve('src/app/api/daily-tasks/route.ts'),m=new Module(file,module);
    m.filename=file;m.paths=module.paths;const req=m.require.bind(m);
    class MoneyError extends Error{}
    m.require=n=>n==='next/server'?{}:n==='@/lib/money-server'?{
      MoneyError,handled:f=>f(),json:v=>v,liveConfig:()=>{throw Error('Gateway must not be called');},
      requireProductionApproval:()=>{throw Error('Independent approval required');},
      authenticate:async()=>({user:{id:'member'},db:{rpc:async(name,args)=>{
        assert.equal(name,'money_daily_task_claim');assert.equal(args.p_threshold,10);claims++;
        return {data:{amount:10000},error:null};
      }}}),
    }:req(n);
    m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,file);
    await assert.rejects(m.exports.POST({json:async()=>({threshold:10})}),/Independent approval required/);
    await assert.rejects(m.exports.POST({json:async()=>({threshold:5})}),/Independent approval required/);
    process.env.MANUAL_PALAWAN_DEPOSITS_ENABLED='false';
    await assert.rejects(m.exports.POST({json:async()=>({threshold:10})}),/Independent approval required/);
    assert.equal(claims,0);
  }finally{flags.forEach((k,i)=>{if(old[i]===undefined)delete process.env[k];else process.env[k]=old[i];});}
});
