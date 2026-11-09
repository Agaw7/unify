const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const Module=require('node:module');
const loaded=new Module(__filename,module);
loaded._compile(ts.transpileModule(fs.readFileSync('src/lib/login-session-navigation.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,__filename);
const {watchLoginSession}=loaded.exports;
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('mobile back-cache pageshow redirects an existing session and cleanup removes listeners',async()=>{
 const target=new EventTarget();let session=false;let dashboard=0,login=0;
 const stop=watchLoginSession(target,async()=>session,()=>dashboard++,()=>login++);
 await flush();assert.equal(login,1);
 session=true;target.dispatchEvent(new Event('pageshow'));await flush();
 assert.equal(dashboard,1);
 session=false;target.dispatchEvent(new Event('focus'));await flush();assert.equal(login,2);
 stop();target.dispatchEvent(new Event('pageshow'));await flush();assert.equal(dashboard,1);assert.equal(login,2);
});
test('an old signed-out result cannot override a newer restored session',async()=>{
 const target=new EventTarget();const pending=[];let dashboard=0,login=0;
 const stop=watchLoginSession(target,()=>new Promise(resolve=>pending.push(resolve)),()=>dashboard++,()=>login++);
 target.dispatchEvent(new Event('pageshow'));
 pending[1](true);await flush();pending[0](false);await flush();
 assert.equal(dashboard,1);assert.equal(login,0);stop();
});
