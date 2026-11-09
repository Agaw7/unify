const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const ts=require('typescript');
class MoneyError extends Error {constructor(message,status=400){super(message);this.status=status;}}
function setup(role='user',automaticAvailable=false){
 const calls=[];
 const db={from:()=>{const q={select:()=>q,eq:()=>q,single:async()=>({data:{role},error:null})};return q;},rpc:async(name,args)=>{calls.push({name,args});return {data:{status:'reserved'},error:null};}};
 const stubs={
  '@/lib/money-server':{MoneyError,authenticate:async()=>({db,user:{id:'verified-user'}}),json:(body,status=200)=>Response.json(body,{status}),handled:async work=>{try{return await work();}catch(e){return Response.json({error:e.message},{status:e.status ?? 500});}}},
  '@/lib/money-validation':{record:value=>value && typeof value==='object'?value:{},uuid:value=>typeof value==='string' && /^[a-f0-9-]{36}$/i.test(value)},
  '@/lib/sandbox-withdrawals':{sandboxPayoutsEnabled:()=>automaticAvailable},
 };
 function load(relative){const file=path.join(__dirname,'..',relative),m=new Module(file,module);m.filename=file;m.paths=module.paths;const original=m.require.bind(m);m.require=name=>stubs[name]??original(name);m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file);return m.exports;}
 return {calls,user:load('src/app/api/withdrawals/sandbox/route.ts'),admin:load('src/app/api/admin/withdrawal-settings/route.ts')};
}
test('withdrawal API ignores forged user IDs and automation flags; only admins can save modes',async()=>{
 const api=setup();
 const body={amount:100,accountId:'11111111-1111-4111-8111-111111111111',key:'22222222-2222-4222-8222-222222222222',userId:'victim',mode:'automatic',p_simulation_enabled:true};
 assert.equal((await api.user.POST({json:async()=>body})).status,200);
 assert.equal(api.calls[0].args.p_user,'verified-user');
 assert.equal(api.calls[0].args.p_simulation_enabled,false);
 assert.equal('mode' in api.calls[0].args,false);
 assert.equal((await api.user.POST({json:async()=>({...body,amount:99})})).status,400);
 assert.equal((await api.admin.POST({json:async()=>({mode:'automatic',version:1})})).status,403);
 assert.equal(api.calls.length,1);
 const admin=setup('admin');
 assert.equal((await admin.admin.POST({json:async()=>({mode:'automatic',version:1})})).status,409);
 assert.equal(admin.calls.length,0);
 assert.equal((await admin.admin.POST({json:async()=>({mode:'admin_approval',version:1,adminId:'forged'})})).status,200);
 assert.equal(admin.calls[0].args.p_admin,'verified-user');
 const enabled=setup('admin',true);
 assert.equal((await enabled.admin.POST({json:async()=>({mode:'automatic',version:1})})).status,200);
});
