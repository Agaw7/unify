const {test}=require('node:test');const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');const {readFileSync}=require('node:fs');const {PGlite}=require('@electric-sql/pglite');
async function install(db){
 await db.exec(`create schema auth;create schema storage;create table auth.users(id uuid primary key,phone text);create role anon;create role authenticated;create role service_role;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(bucket_id text);
 create table profiles(id uuid primary key references auth.users(id),role text);
 create table investment_products(id uuid primary key,name text,price numeric,daily_income numeric);
 create table team_members(id uuid primary key,invited_by uuid,created_at timestamptz default now());`);
 for(const name of ['03_real_money','04_payment_operations','15_qrph_live_deposits','16_withdrawal_only_verification','17_live_withdrawal_modes','18_funded_live_plans','19_purchase_wallet_registration_bonus','27_cash_promotions','32_manual_qrph_deposits','33_withdrawal_fee','39_manual_palawan_deposits','40_manual_gotyme_withdrawals','41_manual_wallet_withdrawals','42_manual_treasury','45_manual_payout_proof','50_treasury_opening_safe_update'])await db.exec(readFileSync(`database/${name}.sql`,'utf8'));
}
test('two-account treasury preserves cash, liabilities, references and opening-snapshot cutoffs',async()=>{
 const db=new PGlite();const [member,admin,sender]=Array.from({length:3},()=>randomUUID());
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 try{
  await install(db);
  await q('insert into auth.users(id) values($1),($2),($3)',[member,admin,sender]);
  await q("insert into profiles values($1,'user'),($2,'admin'),($3,'admin')",[member,admin,sender]);
  const opening=new Date(Date.now()-10000).toISOString(),key=randomUUID();
  const open=actor=>q("select money_treasury_open($1,5000000,5000000,$2,'OPENING-STATEMENT',$3,false,true) s",[actor,key,opening]);
  await assert.rejects(open(member),/Administrator required/);await open(admin);await open(admin);
  const summary=async()=>(await q('select money_treasury_summary() s'))[0].s;
  assert.equal((await summary()).cash,10000000);
  assert.equal((await q('select count(*)::int n from money_treasury_entries'))[0].n,2);
  await q("select money_treasury_fund($1,20000,$2,'MANUAL-FUNDING-1',true)",[admin,randomUUID()]);
  await q("select money_claim_promo($1,'check_in_reward')",[member]);
  assert.equal((await summary()).cash,10000000,'reward credit is a liability, not a bank transfer');
  const deposit=(await q("select money_submit_manual_qrph($1,30000,$2,'PALAWAN-123456789','receipt') id",[member,randomUUID()]))[0].id;
  const received=new Date().toISOString();
  const approve=()=>q("select money_treasury_approve_deposit($1,$2,'123456789',$3)",[deposit,admin,received]);
  await approve();await approve();assert.equal((await summary()).cash,10030000);
  await q('update money_customers set verified=true where user_id=$1',[member]);
  await q('insert into money_wallets(user_id) values($1) on conflict do nothing',[member]);
  const destination=(await q("insert into money_destinations(user_id,method,account_name,account_number,bic,verified) values($1,'gcash','Test Member','09123456789','TESTPHM2XXX',true) returning id",[member]))[0].id;
  await q("insert into money_verifications(user_id,kind,status,expires_at) values($1,'identity','approved',now()+interval '1 day')",[member]);
  await q("insert into money_verifications(user_id,kind,destination_id,status,expires_at) values($1,'ownership',$2,'approved',now()+interval '1 day')",[member,destination]);
  // Move test purchasing funds to available for the withdrawal fixture only.
  await q('update money_wallets set available=30000 where user_id=$1',[member]);
  const tx=(await q("select * from money_request_withdrawal($1,20000,'gcash',$2,$3)",[member,randomUUID(),destination]))[0];
  await q("select money_review($1,$2,'approve','Ownership checked')",[tx.id,admin]);await q('select money_claim_payout($1,$2)',[tx.id,sender]);
  const sent=new Date().toISOString();
  const finish=()=>q("select money_treasury_complete_payout($1,$2,'SEND-12345','succeeded',true,$3,0)",[tx.id,sender,sent]);
  await finish();await finish();
  assert.equal((await summary()).cash,10011000,'cash decreases by PHP190 net, not PHP200 gross');
  const accounts=await q('select id,balance from money_treasury_accounts order by id');
  assert.deepEqual(accounts,[{id:'gotyme',balance:4981000},{id:'palawan',balance:5030000}]);
  const transferKey=randomUUID(),transferAt=new Date().toISOString();
  const transfer=()=>q("select money_treasury_transfer($1,'palawan','gotyme',10000,0,'OWN-TRANSFER-1',$2,$3,true)",[admin,transferAt,transferKey]);
  await transfer();await transfer();assert.equal((await summary()).cash,10011000);
  const old=(await q("select money_submit_manual_qrph($1,30000,$2,'PALAWAN-OLD123','receipt') id",[member,randomUUID()]))[0].id;
  const beforeOpening=new Date(Date.parse(opening)-1000).toISOString();
  await q("select money_treasury_approve_deposit($1,$2,'OLD123',$3)",[old,admin,beforeOpening]);
  assert.equal((await summary()).cash,10011000,'payment already in opening snapshot is not added twice');
  await assert.rejects(q("select money_treasury_fund($1,10000000,$2,'OVERALLOCATE-1',true)",[admin,randomUUID()]),/Insufficient unallocated/);
  await q('update money_wallets set available=30000 where user_id=$1',[member]);
  const maya=(await q("insert into money_destinations(user_id,method,account_name,account_number,bic,verified) values($1,'maya','Test Member','09123456789','TESTPHM2XXX',true) returning id",[member]))[0].id;
  await q("insert into money_verifications(user_id,kind,destination_id,status,expires_at) values($1,'ownership',$2,'approved',now()+interval '1 day')",[member,maya]);
  const duplicate=(await q("select * from money_request_withdrawal($1,20000,'maya',$2,$3)",[member,randomUUID(),maya]))[0];
  await q("select money_review($1,$2,'approve','Ownership checked')",[duplicate.id,admin]);await q('select money_claim_payout($1,$2)',[duplicate.id,sender]);
  await assert.rejects(q("select money_treasury_complete_payout($1,$2,'SEND-12345','succeeded',true,$3,0)",[duplicate.id,sender,new Date().toISOString()]),/duplicate key/);
  assert.equal((await summary()).cash,10011000);
  await q("select money_treasury_complete_payout($1,$2,'FAILED-TRANSFER','failed',true,null,0)",[duplicate.id,sender]);
  assert.equal((await summary()).cash,10011000,'a failed withdrawal does not move bank cash');
  const reconcileKey=randomUUID(),reconciledAt=new Date().toISOString();
  const reconcile=()=>q("select money_treasury_reconcile($1,'palawan',100,$2,'ACTUAL-SHORTFALL',$3,true)",[admin,reconciledAt,reconcileKey]);
  await reconcile();await reconcile();
  assert.equal((await q("select resolved from money_alerts where key='manual-treasury-shortfall'"))[0].resolved,true,'other cash can still cover obligations');
  await q("select money_treasury_reconcile($1,'gotyme',0,$2,'ACTUAL-SHORTFALL-2',$3,true)",[admin,new Date().toISOString(),randomUUID()]);
  assert.equal((await q("select resolved from money_alerts where key='manual-treasury-shortfall'"))[0].resolved,false);
  await db.exec('set role authenticated');
  await assert.rejects(q('select money_treasury_summary()'),/permission denied/);
 }finally{await db.close();}
});

test('manual payout attestation settles a reviewed withdrawal once without a screenshot',async()=>{
 const db=new PGlite();const [member,reviewer,payoutAdmin]=Array.from({length:3},()=>randomUUID());
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 try{
  await install(db);
  await db.exec(readFileSync('database/54_manual_payout_finalization.sql','utf8'));
  await db.exec(readFileSync('database/55_mfa_manual_payout.sql','utf8'));
  await db.exec(readFileSync('database/56_manual_payout_without_verification_review.sql','utf8'));
  await db.exec(readFileSync('database/57_manual_payout_attestation.sql','utf8'));
  await q('insert into auth.users(id) values($1),($2),($3)',[member,reviewer,payoutAdmin]);
  await q("insert into profiles values($1,'user'),($2,'admin'),($3,'admin')",[member,reviewer,payoutAdmin]);
  await q("select money_treasury_open($1,5000000,5000000,$2,'OPENING-STATEMENT',$3,false,true)",[reviewer,randomUUID(),new Date(Date.now()-10000).toISOString()]);
  await q("insert into money_customers(user_id,verified) values($1,true)",[member]);
  const destination=(await q("insert into money_destinations(user_id,method,account_name,account_number,bic,verified) values($1,'gotyme','Test Member','123456789012','TESTPHM2XXX',true) returning id",[member]))[0].id;
  await q("insert into money_verifications(user_id,kind,status,expires_at) values($1,'identity','approved',now()+interval '1 day')",[member]);
  await q("insert into money_verifications(user_id,kind,destination_id,status,expires_at) values($1,'ownership',$2,'approved',now()+interval '1 day')",[member,destination]);
  await q('insert into money_wallets(user_id,available) values($1,30000)',[member]);
  const tx=(await q("select * from money_request_withdrawal($1,20000,'gotyme',$2,$3)",[member,randomUUID(),destination]))[0];
  await q("select money_review($1,$2,'approve','Ownership checked')",[tx.id,reviewer]);
  const proof=`${tx.id}/${randomUUID()}.png`;
  const finalize=(actor,path)=>q('select money_finalize_mfa_manual_payout($1,$2,$3,true)',[tx.id,actor,path]);
  await q('delete from money_verifications where user_id=$1',[member]);
  await q('update money_customers set verified=false,blocked=true where user_id=$1',[member]);
  await q('update money_destinations set verified=false where id=$1',[destination]);
  await assert.rejects(finalize(reviewer,proof),/Account restricted/);
  await q('update money_customers set blocked=false where user_id=$1',[member]);
  await assert.rejects(finalize(member,proof),/Independent payout administrator required/);
  await assert.rejects(finalize(reviewer,'invalid-proof'),/Invalid manual payout confirmation/);
  assert.equal((await q('select status from money_transactions where id=$1',[tx.id]))[0].status,'approved');
  const attest=actor=>q('select money_attest_manual_payout($1,$2)',[tx.id,actor]);
  await assert.rejects(attest(member),/Independent payout administrator required/);
  await attest(reviewer);
  await attest(reviewer);
  const result=(await q('select status,payout_proof_path,payout_confirmed_by,payout_confirmed_at from money_transactions where id=$1',[tx.id]))[0];
  assert.equal(result.status,'completed');
  assert.equal(result.payout_proof_path,null);
  assert.equal(result.payout_confirmed_by,reviewer);
  assert.ok(result.payout_confirmed_at);
  assert.equal((await q('select reserved from money_wallets where user_id=$1',[member]))[0].reserved,0);
  assert.equal((await q("select count(*)::int n from money_ledger where transaction_id=$1 and action='settle'",[tx.id]))[0].n,1);
  assert.equal((await q("select balance from money_treasury_accounts where id='gotyme'"))[0].balance,4981000);
  await assert.rejects(finalize(payoutAdmin,proof),/Invalid manual payout confirmation/);
  await assert.rejects(q('select money_confirm_manual_payout($1,$2,$3,true)',[tx.id,reviewer,`${tx.id}/${randomUUID()}.png`]),/Independent payout administrator required/);
 }finally{await db.close();}
});

test('opening allocation is capped, excludes member funds and cannot be recorded twice',async()=>{
 const db=new PGlite();const admin=randomUUID(),member=randomUUID(),key=randomUUID(),at=new Date().toISOString();
 try{
  await install(db);await db.query('insert into auth.users(id) values($1),($2)',[admin,member]);
  await db.query("insert into profiles values($1,'admin')",[admin]);
  await db.query('insert into money_wallets(user_id,deposit_available) values($1,50000)',[member]);
  const open=limit=>db.query("select money_treasury_open($1,5000000,5000000,$2,'OPEN-ALLOCATION',$3,true,true,$4) s",[admin,key,at,limit]);
  await open(15000);await open(15000);
  assert.equal((await db.query('select available from money_business_budget')).rows[0].available,15000);
  assert.equal((await db.query('select count(*)::int n from money_business_funding')).rows[0].n,1);
  await assert.rejects(open(20000),/already recorded/);
  assert.equal((await db.query('select sum(balance)::bigint total from money_treasury_accounts')).rows[0].total,10000000);
 }finally{await db.close();}
});
