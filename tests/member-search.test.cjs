const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const ts=require('typescript');
const file=path.join(__dirname,'../src/lib/member-search.ts');
const loaded=new Module(file,module);
loaded._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,file);
const {memberMatchesSearch}=loaded.exports;
test('member search matches local, international, formatted and partial Philippine numbers',()=>{
 for(const phone of ['639157471821','+639157471821','09157471821']) {
  for(const search of ['09157471821','639157471821','+639157471821','00639157471821','0915 747 1821','0915-747-1821','0915','1821','']) {
   assert.equal(memberMatchesSearch({id:'a1b2-c3d4',phone},search),true,`${phone}: ${search}`);
  }
  assert.equal(memberMatchesSearch({id:'a1b2-c3d4',phone},'09157471830'),false);
 }
 assert.equal(memberMatchesSearch({id:'A1B2-C3D4',phone:null},'a1b2'),true);
 assert.equal(memberMatchesSearch({id:'A1B2-C3D4',phone:null},'1821'),false);
 assert.equal(memberMatchesSearch({id:'A1B2-C3D4',phone:'639157471821'},'member1821'),false);
});
