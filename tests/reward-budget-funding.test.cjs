const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key);
    create table public.profiles(id uuid primary key references auth.users(id),role text not null);
    create table public.money_treasury_accounts(
      id text primary key,balance bigint not null,reconciled_at timestamptz,confirmed_by uuid,reference text,updated_at timestamptz default now()
    );
    create table public.money_treasury_entries(
      id uuid primary key default gen_random_uuid(),account_id text not null references public.money_treasury_accounts(id),
      entry_key text not null,kind text not null,transaction_id uuid,delta bigint not null,balance_after bigint not null,
      reference text not null,occurred_at timestamptz not null,actor_id uuid not null,details jsonb not null default '{}',
      created_at timestamptz not null default now(),unique(account_id,entry_key)
    );
    create unique index money_treasury_external_reference_once on public.money_treasury_entries(account_id,reference)
      where kind in ('deposit','payout','transfer_in','transfer_out');
    create table public.money_business_budget(
      id boolean primary key,available bigint not null default 0,reserved bigint not null default 0,
      sales bigint not null default 0,funded bigint not null default 0
    );
    create table public.test_business_funding(
      id uuid primary key default gen_random_uuid(),actor_id uuid,amount bigint,idempotency_key uuid unique,reference text unique
    );
    create function public.money_treasury_summary() returns jsonb language sql stable as $$
      with cash as (
        select bool_and(reconciled_at is not null) ready,coalesce(sum(balance),0) total from public.money_treasury_accounts
      ), budget as (
        select available,reserved,sales from public.money_business_budget where id=true
      )
      select jsonb_build_object(
        'ready',cash.ready,
        'cash',cash.total,
        'rewardAvailable',budget.available,
        'unallocated',greatest(0,cash.total-budget.available-budget.reserved-budget.sales),
        'shortfall',greatest(0,budget.available+budget.reserved+budget.sales-cash.total)
      ) from cash cross join budget
    $$;
    create function public.money_treasury_post(
      p_account text,p_key text,p_kind text,p_tx uuid,p_delta bigint,p_reference text,
      p_at timestamptz,p_actor uuid,p_details jsonb default '{}'
    ) returns void language plpgsql as $$
    declare a public.money_treasury_accounts;
    begin
      select * into strict a from public.money_treasury_accounts where id=p_account for update;
      update public.money_treasury_accounts set balance=balance+p_delta where id=p_account;
      insert into public.money_treasury_entries(account_id,entry_key,kind,transaction_id,delta,balance_after,reference,occurred_at,actor_id,details)
      values(p_account,p_key,p_kind,p_tx,p_delta,a.balance+p_delta,p_reference,p_at,p_actor,p_details);
    end $$;
    create function public.money_treasury_fund(p_actor uuid,p_amount bigint,p_key uuid,p_reference text,p_confirm boolean)
    returns uuid language plpgsql as $$
    declare prior public.test_business_funding; funding_id uuid; s jsonb;
    begin
      select * into prior from public.test_business_funding where idempotency_key=p_key;
      if found then
        if prior.amount<>p_amount or prior.actor_id<>p_actor or prior.reference<>p_reference then raise exception 'Funding request conflict'; end if;
        return prior.id;
      end if;
      s:=public.money_treasury_summary();
      if not p_confirm or (s->>'unallocated')::bigint<p_amount then raise exception 'Insufficient unallocated recorded cash'; end if;
      insert into public.test_business_funding(actor_id,amount,idempotency_key,reference)
      values(p_actor,p_amount,p_key,p_reference) returning id into funding_id;
      update public.money_business_budget set available=available+p_amount,funded=funded+p_amount where id=true;
      return funding_id;
    end $$;
  `);
  await db.exec(fs.readFileSync('database/49_reward_budget_verified_deposit.sql', 'utf8'));
  return db;
}

test('verified own-fund deposit atomically increases cash and reward budget and is idempotent', async () => {
  const db = await setup();
  try {
    const admin = randomUUID(), key = randomUUID();
    await db.query('insert into auth.users values($1)', [admin]);
    await db.query("insert into profiles values($1,'admin')", [admin]);
    await db.query("insert into money_treasury_accounts(id,balance,reconciled_at) values('palawan',1000000,now()-interval '1 hour'),('gotyme',0,now()-interval '1 hour')");
    await db.query('insert into money_business_budget(id) values(true)');
    const at = new Date(Date.now() - 60_000).toISOString();
    const fund = () => db.query(
      "select money_treasury_reward_deposit($1,'palawan',100000,$2,'business-deposit-001',$3,true) as result",
      [admin, key, at],
    );
    const first = (await fund()).rows[0].result;
    assert.equal(first.alreadyRecorded, false);
    assert.equal(first.rewardAvailable, 100000);
    const retry = (await fund()).rows[0].result;
    assert.equal(retry.alreadyRecorded, true);
    assert.equal((await db.query("select balance from money_treasury_accounts where id='palawan'")).rows[0].balance, 1100000);
    assert.equal((await db.query('select available from money_business_budget where id=true')).rows[0].available, 100000);
    assert.equal((await db.query("select count(*)::int as n from money_treasury_entries where kind='deposit'")).rows[0].n, 1);
    assert.equal((await db.query('select count(*)::int as n from test_business_funding')).rows[0].n, 1);
  } finally {
    await db.close();
  }
});

test('reward funding deposit rolls back if actual cash reference is duplicated or account is not reconciled', async () => {
  const db = await setup();
  try {
    const admin = randomUUID(), firstKey = randomUUID(), nextKey = randomUUID();
    await db.query('insert into auth.users values($1)', [admin]);
    await db.query("insert into profiles values($1,'admin')", [admin]);
    await db.query("insert into money_treasury_accounts(id,balance,reconciled_at) values('palawan',1000000,now()-interval '1 hour'),('gotyme',0,now()-interval '1 hour')");
    await db.query('insert into money_business_budget(id) values(true)');
    const at = new Date(Date.now() - 60_000).toISOString();
    const deposit = (account, key, reference) => db.query(
      'select money_treasury_reward_deposit($1,$2,100000,$3,$4,$5,true)',
      [admin, account, key, reference, at],
    );
    await deposit('palawan', firstKey, 'business-deposit-002');
    await assert.rejects(deposit('palawan', nextKey, 'business-deposit-002'), /duplicate key value violates unique constraint/);
    await db.exec("update money_treasury_accounts set reconciled_at=null where id='gotyme'");
    await assert.rejects(deposit('gotyme', nextKey, 'business-deposit-003'), /Confirm the account opening balance before recording a deposit/);
    assert.equal((await db.query('select available from money_business_budget where id=true')).rows[0].available, 100000);
    assert.equal((await db.query('select count(*)::int as n from money_treasury_entries')).rows[0].n, 1);
  } finally {
    await db.close();
  }
});
