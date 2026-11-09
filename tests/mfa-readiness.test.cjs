const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const ts=require('typescript');const Module=require('node:module');
const loaded=new Module(__filename,module);
loaded._compile(ts.transpileModule(fs.readFileSync('src/lib/mfa-readiness.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,__filename);
const {needsVerifiedMfaEmail}=loaded.exports;
test('phone-only and unconfirmed-email accounts cannot enter new TOTP enrollment',()=>{
 assert.equal(needsVerifiedMfaEmail(null),true);
 assert.equal(needsVerifiedMfaEmail({}),true);
 assert.equal(needsVerifiedMfaEmail({email:'',email_confirmed_at:'2026-01-01'}),true);
 assert.equal(needsVerifiedMfaEmail({email:'   ',email_confirmed_at:'2026-01-01'}),true);
 assert.equal(needsVerifiedMfaEmail({email:'admin@example.com'}),true);
 assert.equal(needsVerifiedMfaEmail({email:'admin@example.com',email_confirmed_at:'2026-01-01'}),false);
});
