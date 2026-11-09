const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

test('GCash approval credits purchases once and rejects reuse across members', async () => {
  const db = new PGlite();
  const [member, other, admin] = Array.from({ length: 3 }, () => randomUUID());
  const query = async (sql, args) => (await db.query(sql, args)).rows;
  try {
    await db.exec(`create schema auth;
      create table auth.users(id uuid primary key,phone text);
      create role anon; create role authenticated; create role service_role;
      create table profiles(id uuid primary key references auth.users(id),role text);
      create table investment_products(id uuid primary key,name text,price numeric,daily_income numeric);
      create table team_members(id uuid primary key,invited_by uuid,created_at timestamptz default now());`);
    for (const name of ['03_real_money', '04_payment_operations', '15_qrph_live_deposits',
      '16_withdrawal_only_verification', '17_live_withdrawal_modes', '18_funded_live_plans',
      '19_purchase_wallet_registration_bonus', '32_manual_qrph_deposits', '37_manual_gcash_deposits']) {
      await db.exec(readFileSync(`database/${name}.sql`, 'utf8'));
    }
    await query('insert into auth.users(id) values($1),($2),($3)', [member, other, admin]);
    await query("insert into profiles values($1,'user'),($2,'user'),($3,'admin')", [member, other, admin]);
    const submit = async user => (await query("select money_submit_manual_qrph($1,30000,$2,'GCASH-123456789','receipt') id", [user, randomUUID()]))[0].id;
    const approve = (id, actor = admin) => query("select money_approve_gcash_deposit($1,$2,'123456789')", [id, actor]);
    const first = await submit(member);
    const duplicate = await submit(other);
    await assert.rejects(approve(first, member), /Independent administrator required/);
    await approve(first);
    await approve(first);
    await assert.rejects(approve(duplicate), /GCash reference already credited/);
    const [wallet] = await query('select available,held,deposit_available from money_wallets where user_id=$1', [member]);
    assert.deepEqual(wallet, { available: 0, held: 0, deposit_available: 30000 });
  } finally {
    await db.close();
  }
});
