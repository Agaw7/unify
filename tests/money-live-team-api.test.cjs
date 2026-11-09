const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const ts=require('typescript');
test('live team requires authentication and scopes commissions to the signed-in member',async()=>{
 const file=path.resolve('src/app/api/team/route.ts');let signedIn=true;const calls=[];
 const chain={select:()=>chain,eq:(column,value)=>{calls.push([column,value]);return chain;},single:async()=>({data:{short_invite_code:'ABC123',invite_code:'OLD'},error:null})};
 const server={MoneyError:class extends Error{constructor(message,status=400){super(message);this.status=status;}},authenticate:async()=>{if(!signedIn)throw new server.MoneyError('Please sign in',401);return{db:{from:table=>{assert.equal(table,'profiles');return chain;}},user:{id:'signed-in-user'}};},handled:async fn=>{try{return await fn();}catch(e){return{status:e.status,body:{error:e.message}};}},json:(body,status=200)=>({body,status}),rpc:async(name,args)=>{assert.equal(name,'money_live_team');assert.deepEqual(args,{p_user:'signed-in-user'});return{total_commission:6000,levels:[]};}};
 const m=new Module(file,module);m.filename=file;m.paths=module.paths;const req=m.require.bind(m);m.require=n=>n==='@/lib/money-server'?server:req(n);m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,file);
 const result=await m.exports.GET({url:'https://example.test/api/team?userId=other-user'});assert.equal(result.body.inviteCode,'ABC123');assert.equal(result.body.team.total_commission,6000);assert.deepEqual(calls,[['id','signed-in-user']]);
 signedIn=false;assert.equal((await m.exports.GET({})).status,401);
});
