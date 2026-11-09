const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const ts=require('typescript');

function load(relative, dependencies) {
  const file=path.resolve(relative);
  const mod=new Module(file,module);
  mod.filename=file;
  mod.paths=module.paths;
  const requireFromFile=mod.require.bind(mod);
  mod.require=name=>Object.hasOwn(dependencies,name)?dependencies[name]:requireFromFile(name);
  mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},
  }).outputText,file);
  return mod.exports;
}

const id='224aa400-12a0-4eaf-a84e-0dfa02caa3bf';
const image=new Uint8Array([137,80,78,71,13,10,26,10]);

for (const scenario of [
  {
    route:'deposits',
    table:'manual_qrph_deposits',
    bucket:'manual-deposit-receipts',
    record:{receipt_path:'fixture/receipt.png'},
  },
  {
    route:'withdrawals',
    table:'money_transactions',
    bucket:'withdrawal-payout-proofs',
    record:{status:'completed',payout_proof_path:'fixture/payout.png'},
  },
]) {
  test(scenario.route+' proof requires a valid admin session and serves private bytes',async()=>{
    const oldUrl=process.env.NEXT_PUBLIC_SUPABASE_URL;
    const oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_URL='https://sandbox-fixture.invalid';
    process.env.SUPABASE_SERVICE_ROLE_KEY='fixture-server-key';
    let downloads=0;
    const db={
      auth:{getUser:async token=>['member','admin'].includes(token)
        ?{data:{user:{id:token}},error:null}:{data:{user:null},error:new Error('Invalid token')}},
      from(table){
        assert.ok(['profiles',scenario.table].includes(table));
        const query={select:()=>query,eq:()=>query,
          maybeSingle:async()=>({data:scenario.record,error:null}),
          single:async()=>({data:table==='profiles'?{role:query.user==='admin'?'admin':'user'}:scenario.record,error:null})};
        query.eq=(column,value)=>{if(table==='profiles'&&column==='id')query.user=value;return query;};
        return query;
      },
      storage:{from(bucket){
        assert.equal(bucket,scenario.bucket);
        return {download:async objectPath=>{
          assert.equal(objectPath,scenario.record.receipt_path??scenario.record.payout_proof_path);
          downloads++;
          return {data:new Blob([image]),error:null};
        }};
      }},
    };
    try {
      const server=load('src/lib/money-server.ts',{
        '@supabase/supabase-js':{createClient:url=>{assert.equal(url,'https://sandbox-fixture.invalid');return db;}},
        './payment-readiness':{productionPaymentsAuthorized:false},
      });
      const validation=load('src/lib/money-validation.ts',{});
      const route=load('src/app/api/admin/'+scenario.route+'/[id]/proof/route.ts',{
        '@/lib/money-server':server,'@/lib/money-validation':validation,
      });
      const request=token=>route.GET(new Request('http://localhost/proof',{
        headers:token?{Authorization:'Bearer '+token}:{},
      }),{params:Promise.resolve({id})});
      assert.equal((await request()).status,401);
      assert.equal((await request('expired')).status,401);
      assert.equal((await request('member')).status,403);
      assert.equal(downloads,0);
      const result=await request('admin');
      assert.equal(result.status,200);
      assert.equal(result.headers.get('Cache-Control'),'private, no-store');
      assert.equal(result.headers.get('Content-Type'),'image/png');
      assert.deepEqual(new Uint8Array(await result.arrayBuffer()),image);
      assert.equal(downloads,1);
    } finally {
      if(oldUrl===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      else process.env.NEXT_PUBLIC_SUPABASE_URL=oldUrl;
      if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey;
    }
  });
}
