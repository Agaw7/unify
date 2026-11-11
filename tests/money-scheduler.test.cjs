const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
const ts=require('typescript');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');

test('scheduler rejects unauthenticated requests and runs only with its configured secret',async()=>{
 const file=path.join(__dirname,'../src/app/api/jobs/reconcile-payments/route.ts');
 const loaded=new Module(file,module);loaded.filename=file;loaded.paths=module.paths;
 const base=loaded.require.bind(loaded);let runs=0;
 class MoneyError extends Error {constructor(message,status){super(message);this.status=status;}}
 const json=(body,status=200)=>Response.json(body,{status});
 loaded.require=name=>{
  if(name==='@/lib/money-server') return {
   MoneyError,json,
   handled:async work=>{try{return await work();}catch(e){return json({error:e.message},e.status ?? 500);}},
  };
  if(name==='@/lib/payment-readiness') return {productionPaymentsAuthorized:false};
  if(name==='@/lib/money-operations') return {runReconciliation:async()=>{runs++;return {paused:true,reason:'Automated provider reconciliation is unavailable.'};}};
  return base(name);
 };
 loaded._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file);
 const get=authorization=>loaded.exports.GET(new Request('https://staging.example/api/jobs/reconcile-payments',{headers:authorization ? {authorization} : {}}));
 const previous=process.env.CRON_SECRET;
 try {
  delete process.env.CRON_SECRET;
  assert.equal((await get()).status,503);
  const secret=randomBytes(32).toString('hex');process.env.CRON_SECRET=secret;
  assert.equal((await get()).status,401);
  assert.equal((await get(`Bearer ${'0'.repeat(secret.length)}`)).status,401);
  assert.equal((await get(`Basic ${secret}`)).status,401);
  assert.equal(runs,0);
  const response=await get(`Bearer ${secret}`);
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{paused:true,reason:'Automated provider reconciliation is unavailable.',tierRewards:{status:'paused_pending_approval'},purchaseCommissions:{status:'paused_pending_approval'}});assert.equal(runs,1);
 } finally {if(previous===undefined) delete process.env.CRON_SECRET;else process.env.CRON_SECRET=previous;}
});
