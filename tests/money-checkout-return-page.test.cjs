const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const Module=require('node:module');const ts=require('typescript');
test('existing cancelled and returned wallet URLs redirect before showing the wallet screen',async()=>{
 const file=path.resolve('src/app/money/page.tsx'),m=new Module(file,module);m.filename=file;m.paths=module.paths;const req=m.require.bind(m);m.require=n=>n==='next/navigation'?{redirect:url=>{throw new Error('REDIRECT '+url);}}:n==='@/components/MoneyWalletPage'?{default:()=>null}:req(n);
 m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,file);
 for(const checkout of ['cancelled','returned'])await assert.rejects(m.exports.default({searchParams:Promise.resolve({checkout})}),/REDIRECT \/dashboard/);
 assert.ok(await m.exports.default({searchParams:Promise.resolve({})}));
});
