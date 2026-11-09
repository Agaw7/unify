const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

test('manual deposit screenshots are private and verified credits remain atomic', async () => {
  const db = new PGlite();
  const [member, rejectedMember, admin] = Array.from({ length: 3 }, () => randomUUID());
  const query = async (sql, args = []) => (await db.query(sql, args)).rows;
  try {
    await db.exec(`create schema auth;
      create schema storage;
      create table auth.users(id uuid primary key,phone text);
      create role anon; create role authenticated; create role service_role;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(bucket_id text);
      create table profiles(id uuid primary key references auth.users(id),role text);
      create table investment_products(id uuid primary key,name text,price numeric,daily_income numeric);
      create table team_members(id uuid primary key,invited_by uuid,created_at timestamptz default now());`);
    for (const name of ['03_real_money', '04_payment_operations', '15_qrph_live_deposits',
      '16_withdrawal_only_verification', '17_live_withdrawal_modes', '18_funded_live_plans',
      '19_purchase_wallet_registration_bonus', '32_manual_qrph_deposits', '37_manual_gcash_deposits',
      '39_manual_palawan_deposits', '46_manual_deposit_private_receipts']) {
      await db.exec(readFileSync(`database/${name}.sql`, 'utf8'));
    }

    await query('insert into auth.users(id) values($1),($2),($3)', [member, rejectedMember, admin]);
    await query("insert into profiles values($1,'user'),($2,'user'),($3,'admin')", [member, rejectedMember, admin]);

    async function submit(user, reference) {
      const key = randomUUID();
      const path = `${user}/${key}/${'a'.repeat(64)}.png`;
      const id = (await query(`select money_submit_manual_qrph_private(
        $1,30000,$2,$3,$4) id`, [user, key, reference, path]))[0].id;
      return { id, path, key };
    }

    const pending = await submit(member, 'PALAWAN-123456789');
    let row = (await query(`select t.status,w.deposit_available,d.receipt,d.receipt_path,d.has_receipt
      from money_transactions t join money_wallets w on w.user_id=t.user_id
      join manual_qrph_deposits d on d.transaction_id=t.id where t.id=$1`, [pending.id]))[0];
    assert.deepEqual(row, {
      status: 'pending', deposit_available: 0, receipt: null,
      receipt_path: pending.path, has_receipt: true,
    });

    await assert.rejects(query('select money_submit_manual_qrph_private($1,30000,$2,$3,$4)', [
      member, pending.key, 'PALAWAN-999999999', pending.path,
    ]), /Manual deposit request details changed/);
    await query("select money_approve_palawan_deposit($1,$2,'123456789')", [pending.id, admin]);
    await query("select money_approve_palawan_deposit($1,$2,'123456789')", [pending.id, admin]);
    row = (await query(`select t.status,w.deposit_available,
      (select count(*)::int from money_ledger l where l.transaction_id=t.id and l.action='deposit') credits
      from money_transactions t join money_wallets w on w.user_id=t.user_id where t.id=$1`, [pending.id]))[0];
    assert.deepEqual(row, { status: 'completed', deposit_available: 30000, credits: 1 });

    const rejected = await submit(rejectedMember, 'GCASH-123456789');
    await query("select money_reject_manual_qrph($1,$2,'Reference not found')", [rejected.id, admin]);
    await query("select money_reject_manual_qrph($1,$2,'A repeated rejection note')", [rejected.id, admin]);
    await assert.rejects(query("select money_approve_gcash_deposit($1,$2,'123456789')", [rejected.id, admin]), /already linked or reviewed/);
    assert.equal((await query('select status from money_transactions where id=$1', [rejected.id]))[0].status, 'rejected');
    assert.equal((await query('select deposit_available from money_wallets where user_id=$1', [rejectedMember]))[0].deposit_available, 0);

    await assert.rejects(db.exec(`set role authenticated;
      select * from manual_qrph_deposits;
      reset role;`), /permission denied/);
    const bucket = (await query("select public,file_size_limit,allowed_mime_types from storage.buckets where id='manual-deposit-receipts'"))[0];
    assert.deepEqual(bucket, { public: false, file_size_limit: 5242880, allowed_mime_types: ['image/png', 'image/jpeg'] });
    const policy = (await query(`select permissive,qual,with_check from pg_policies
      where tablename='objects' and policyname='Deny client access to manual deposit receipts'`))[0];
    assert.equal(policy.permissive, 'RESTRICTIVE');
    assert.match(policy.qual, /manual-deposit-receipts/);
  } finally {
    await db.close();
  }
});
