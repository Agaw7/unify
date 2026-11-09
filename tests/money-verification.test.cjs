const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const Module=require('module');const ts=require('typescript');
class MoneyError extends Error{constructor(message,status=400){super(message);this.status=status;}}
function route({existing=null,recipient=true,authenticated=true}={}){
 const calls=[];const db={from:table=>{const q={};for(const method of ['select','eq','in','is','update','insert'])q[method]=(...args)=>{calls.push([table,method,...args]);return q;};q.maybeSingle=async()=>({data:existing,error:null});q.single=async()=>({data:table==='money_destinations'?(recipient?{id:'recipient'}:null):{id:'request',status:'submitted'},error:null});return q;}};
 const server={MoneyError,authenticate:async()=>{if(!authenticated)throw new MoneyError('Sign in',401);return{db,user:{id:'member'}};},json:body=>Response.json(body),handled:async fn=>{try{return await fn();}catch(e){return Response.json({error:e.message},{status:e.status??500});}}};
 const file=path.resolve('src/app/api/money/verification/route.ts'),m=new Module(file,module);m.filename=file;m.paths=module.paths;const req=m.require.bind(m);m.require=n=>n==='@/lib/money-server'?server:n==='@/lib/money-validation'?{record:v=>v,uuid:v=>typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v)}:req(n);m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,file);return{post:body=>m.exports.POST({json:async()=>body}),calls};
}
const body={kind:'identity',evidenceReference:'CASE-12345',confirmed:true};
test('verification requires a signed-in member, a case reference and declaration',async()=>{
 const anonymous=route({authenticated:false});assert.equal((await anonymous.post(body)).status,401);assert.equal(anonymous.calls.length,0);
 for(const invalid of [{...body,confirmed:false},{...body,evidenceReference:''},{...body,evidenceReference:'https://secret.example?token=private'},{...body,kind:'approved'}]){const r=route();assert.equal((await r.post(invalid)).status,400);assert.equal(r.calls.length,0);}
});
test('submission is scoped to member and never grants approval',async()=>{
 const r=route();assert.equal((await r.post({...body,userId:'other',status:'approved'})).status,200);const insert=r.calls.find(c=>c[1]==='insert')[2];assert.deepEqual(insert,{user_id:'member',kind:'identity',destination_id:null,status:'submitted',evidence_reference:'CASE-12345'});
});
test('duplicate pending reviews return existing request without a new insert',async()=>{
 const r=route({existing:{id:'old',status:'submitted',expires_at:null}});const result=await(await r.post(body)).json();assert.equal(result.verification.id,'old');assert.equal(r.calls.some(c=>c[1]==='insert'),false);
});
test('ownership review cannot target another member recipient',async()=>{
 const r=route({recipient:false});assert.equal((await r.post({...body,kind:'ownership',destinationId:'7c9cffce-4bd6-47ad-8335-65dcdad555aa'})).status,404);assert.ok(r.calls.some(c=>c[0]==='money_destinations'&&c[1]==='eq'&&c[2]==='user_id'&&c[3]==='member'));assert.equal(r.calls.some(c=>c[1]==='insert'),false);
});

function adminRoute(review){
 const calls=[];const q={select:()=>q,eq:()=>q,single:async()=>({data:review,error:null})};
 const server={MoneyError,authenticate:async()=>({db:{from:()=>q},user:{id:'admin'}}),rpc:async(...args)=>calls.push(args),json:v=>Response.json(v),handled:async f=>{try{return await f();}catch(e){return Response.json({error:e.message},{status:e.status??500});}}};
 const file=path.resolve('src/app/api/admin/money/operations/route.ts'),m=new Module(file,module);m.filename=file;m.paths=module.paths;const req=m.require.bind(m);m.require=n=>n==='@/lib/money-server'?server:n==='@/lib/money-operations'?{}:n==='@/lib/money-validation'?{record:v=>v,uuid:()=>true}:req(n);m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,file);return{post:body=>m.exports.POST({json:async()=>body}),calls};
}
test('manual approval enforces feature flag, independent review, evidence confirmation and ownership BIC',async()=>{
 const old=process.env.VERIFICATION_REVIEW_ENABLED;
 const request={action:'verification',id:'request',status:'approved',provider:'UNIFY manual review v1',reason:'Evidence checked CASE-12345',expires:new Date(Date.now()+86400000).toISOString(),evidenceChecked:true};
 try{
 delete process.env.VERIFICATION_REVIEW_ENABLED;let r=adminRoute({user_id:'member',kind:'identity',status:'submitted'});assert.equal((await r.post(request)).status,503);assert.equal(r.calls.length,0);
 process.env.VERIFICATION_REVIEW_ENABLED='true';r=adminRoute({user_id:'admin',kind:'identity',status:'submitted'});assert.equal((await r.post(request)).status,403);assert.equal(r.calls.length,0);
 r=adminRoute({user_id:'member',kind:'identity',status:'submitted'});assert.equal((await r.post({...request,evidenceChecked:false})).status,400);assert.equal(r.calls.length,0);assert.equal((await r.post(request)).status,200);assert.equal(r.calls[0][0],'money_verification_decide');
 r=adminRoute({user_id:'member',kind:'ownership',status:'submitted'});assert.equal((await r.post(request)).status,400);assert.equal(r.calls.length,0);
 r=adminRoute({user_id:'member',kind:'identity',status:'approved'});assert.equal((await r.post(request)).status,409);assert.equal(r.calls.length,0);
 }finally{if(old===undefined)delete process.env.VERIFICATION_REVIEW_ENABLED;else process.env.VERIFICATION_REVIEW_ENABLED=old;}
});
