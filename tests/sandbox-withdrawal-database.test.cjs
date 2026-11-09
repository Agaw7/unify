const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

test('withdrawal migration creates an atomic, owner-scoped, idempotent reservation', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql as $$ select '11111111-1111-4111-8111-111111111111'::uuid $$;
      create table public.sandbox_wallets(user_id uuid primary key, remaining_balance numeric);
      create table public.payment_accounts(id uuid primary key, user_id uuid, provider text);
      create table public.sandbox_withdrawal_requests(id uuid primary key default gen_random_uuid(), user_id uuid, amount numeric, currency text, status text, payment_method text, created_at timestamptz default now());
      insert into sandbox_wallets values ('11111111-1111-4111-8111-111111111111',615);
      insert into payment_accounts values ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','gcash');
    `);
    const sql = fs.readFileSync(path.join(__dirname, '../database/02_sandbox_withdrawals.sql'), 'utf8');
    await db.exec(sql);
    await db.exec(sql);
    const reserve = amount => db.query(`select request_sandbox_withdrawal(p_amount => $1, p_idempotency_key => '33333333-3333-4333-8333-333333333333', p_payment_account_id => '22222222-2222-4222-8222-222222222222') as result`, [amount]);
    assert.equal((await reserve(100)).rows[0].result.remaining_balance, 515);
    assert.equal((await reserve(100)).rows[0].result.replayed, true);
    await assert.rejects(reserve(200), /different details/);
    await assert.rejects(db.query(`select request_sandbox_withdrawal(600,'22222222-2222-4222-8222-222222222222','44444444-4444-4444-8444-444444444444')`), /Insufficient/);
    await assert.rejects(db.query(`select request_sandbox_withdrawal(100,'55555555-5555-4555-8555-555555555555','44444444-4444-4444-8444-444444444444')`), /valid saved/);
    assert.equal(Number((await db.query('select remaining_balance from sandbox_wallets')).rows[0].remaining_balance), 515);
    assert.equal(Number((await db.query('select count(*) from sandbox_withdrawal_requests')).rows[0].count), 1);
  } finally { await db.close(); }
});
