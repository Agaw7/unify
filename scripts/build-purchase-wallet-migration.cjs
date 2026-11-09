// Builds a forward migration from reviewed, versioned function bodies.
const fs = require('node:fs');
function body(file, name) {
  const source = fs.readFileSync(`database/${file}`, 'utf8').replace(/\r\n/g, '\n');
  const match = source.match(new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]*?end \\$\\$;`, 'i'));
  if (!match) throw Error(`Function missing: ${name}`);
  return match[0].replace(/^create function/i, 'create or replace function');
}
function change(sql, from, to) {
  from = from.replace(/\r\n/g, '\n');
  to = to.replace(/\r\n/g, '\n');
  if (!sql.includes(from)) throw Error(`Migration source changed: ${from}`);
  return sql.replace(from, to);
}
let release = body('04_payment_operations.sql', 'money_release_hold');
release = change(release, 'available=available+h.remaining-repayment', 'deposit_available=deposit_available+h.remaining-repayment');
release = change(release, 'action,available_delta,reserved_delta,held_delta,debt_delta) values(t.user_id,t.id,\'settlement_release\',h.remaining-repayment,0,-h.remaining,-repayment)', 'action,available_delta,reserved_delta,held_delta,debt_delta,deposit_delta) values(t.user_id,t.id,\'settlement_release\',0,0,-h.remaining,-repayment,h.remaining-repayment)');
let open = body('04_payment_operations.sql', 'money_adjustment_open');
open = change(open, 'hp bigint; ap bigint; gap bigint;', 'hp bigint; ap bigint; dp bigint; gap bigint;');
open = change(open, 'hp=least(coalesce(h.remaining,0),p_amount); ap=least(w.available,p_amount-hp);gap=p_amount-hp-ap;', 'hp=least(coalesce(h.remaining,0),p_amount); dp=least(w.deposit_available,p_amount-hp); ap=least(w.available,p_amount-hp-dp);gap=p_amount-hp-dp-ap;');
open = change(open, 'held_part,available_part,shortfall,debt_remaining,created_by,reason)', 'held_part,available_part,shortfall,debt_remaining,created_by,reason,deposit_part)');
open = change(open, 'p_reference,p_key,hp,ap,gap,gap,p_actor,p_reason)', 'p_reference,p_key,hp,ap,gap,gap,p_actor,p_reason,dp)');
open = change(open, 'held=held-hp,available=available-ap,reserved=reserved+hp+ap', 'held=held-hp,available=available-ap,deposit_available=deposit_available-dp,reserved=reserved+hp+ap+dp');
open = change(open, "action,available_delta,reserved_delta,held_delta,debt_delta) values(t.user_id,t.id,'adjustment_reserve:'||a.id,-ap,hp+ap,-hp,gap)", "action,available_delta,reserved_delta,held_delta,debt_delta,deposit_delta) values(t.user_id,t.id,'adjustment_reserve:'||a.id,-ap,hp+ap+dp,-hp,gap,-dp)");
let finish = body('04_payment_operations.sql', 'money_adjustment_finish');
finish = change(finish, 'reserved=reserved-a.held_part-a.available_part,', 'reserved=reserved-a.held_part-a.available_part-a.deposit_part,');
finish = change(finish, 'available=available+case when returning_funds then a.available_part+a.shortfall-a.debt_remaining else 0 end,', 'available=available+case when returning_funds then a.available_part else 0 end,\n deposit_available=deposit_available+case when returning_funds then a.deposit_part+a.shortfall-a.debt_remaining else 0 end,');
finish = change(finish, 'action,available_delta,reserved_delta,held_delta,debt_delta)\r\n values', 'action,available_delta,reserved_delta,held_delta,debt_delta,deposit_delta)\r\n values');
finish = change(finish, "'adjustment_finish:'||a.id,case when returning_funds then a.available_part+a.shortfall-a.debt_remaining else 0 end,-a.held_part-a.available_part,hp,case when returning_funds then -a.debt_remaining else 0 end)", "'adjustment_finish:'||a.id,case when returning_funds then a.available_part else 0 end,-a.held_part-a.available_part-a.deposit_part,hp,case when returning_funds then -a.debt_remaining else 0 end,case when returning_funds then a.deposit_part+a.shortfall-a.debt_remaining else 0 end)");
let fund = body('18_funded_live_plans.sql', 'money_business_fund');
fund = change(fund, 'sum(available::numeric+reserved+held)', 'sum(available::numeric+reserved+held+deposit_available)');
let purchase = body('18_funded_live_plans.sql', 'money_investment_open');
purchase = change(purchase, 'daily bigint; tx uuid;', 'daily bigint; tx uuid; w public.money_wallets; from_deposit bigint; from_available bigint;');
purchase = change(purchase, 'update public.money_wallets set available=available-price where user_id=p_user and available>=price;\r\n if not found then raise exception \'Insufficient available balance\'; end if;', "select * into strict w from public.money_wallets where user_id=p_user for update;\n if w.available::numeric+w.deposit_available<price then raise exception 'Insufficient available balance'; end if;\n from_deposit=least(w.deposit_available,price);from_available=price-from_deposit;\n update public.money_wallets set deposit_available=deposit_available-from_deposit,available=available-from_available where user_id=p_user;");
purchase = change(purchase, "action,available_delta,reserved_delta) values(p_user,tx,'plan_purchase',-price,0)", "action,available_delta,reserved_delta,deposit_delta) values(p_user,tx,'plan_purchase',-from_available,0,-from_deposit)");
const head = `-- Requires migrations 03,04,15,16,17,18. No sandbox money is imported.
begin;
set local lock_timeout='10s';
do $$ begin
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='money_wallets' and column_name='deposit_available')
 and (exists(select 1 from public.money_wallets where available<>0 or reserved<>0 or held<>0 or debt<>0) or exists(select 1 from public.money_ledger)) then
 raise exception 'Existing live ledger requires a reviewed source-of-funds reconciliation before migration 19';
 end if;
end $$;
alter table public.money_wallets add column if not exists deposit_available bigint not null default 0 check(deposit_available>=0);
alter table public.money_ledger add column if not exists deposit_delta bigint not null default 0;
alter table public.money_adjustments add column if not exists deposit_part bigint not null default 0 check(deposit_part>=0);
do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid='public.money_adjustments'::regclass and contype='c' and pg_get_constraintdef(oid) like '%held_part%' and pg_get_constraintdef(oid) like '%shortfall%' loop
 execute format('alter table public.money_adjustments drop constraint %I',c.conname);
 end loop;
end $$;
alter table public.money_adjustments add constraint money_adjustment_parts check(held_part+available_part+deposit_part+shortfall=amount);
alter table public.money_transactions drop constraint if exists money_transactions_kind_check;
alter table public.money_transactions add constraint money_transactions_kind_check check(kind in ('deposit','withdrawal','investment_purchase','investment_return','referral_commission','registration_bonus'));
create table if not exists public.money_registration_bonuses(
 user_id uuid primary key references auth.users(id), transaction_id uuid not null unique references public.money_transactions(id),
 amount bigint not null default 3000 check(amount=3000),created_at timestamptz not null default now()
);
alter table public.money_registration_bonuses enable row level security;
revoke all on public.money_registration_bonuses from public,anon,authenticated,service_role;
grant select on public.money_registration_bonuses to service_role;
`;
const bonus = `
create or replace function public.money_registration_bonus(p_user uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare existing uuid; tx uuid;
begin
 perform 1 from public.money_business_budget where id=true for update;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 select transaction_id into existing from public.money_registration_bonuses where user_id=p_user;
 if found then return existing; end if;
 if p_user is null or not public.money_deposit_ready(p_user) then raise exception 'Account restricted'; end if;
 update public.money_business_budget set available=available-3000 where id=true and available>=3000;
 if not found then raise exception 'Registration bonus is awaiting business funding'; end if;
 insert into public.money_transactions(user_id,kind,amount,method,status,idempotency_key) values(p_user,'registration_bonus',3000,'internal','completed',gen_random_uuid()) returning id into tx;
 insert into public.money_wallets(user_id,available) values(p_user,3000) on conflict(user_id) do update set available=public.money_wallets.available+3000;
 insert into public.money_ledger(user_id,transaction_id,action,available_delta,reserved_delta) values(p_user,tx,'registration_bonus',3000,0);
 insert into public.money_registration_bonuses(user_id,transaction_id) values(p_user,tx);
 insert into public.money_business_ledger(action,subject_id,available_delta) values('registration_bonus',tx,-3000);
 insert into public.money_audit(subject_id,action,details) values(p_user,'registration_bonus',jsonb_build_object('amount',3000,'transaction',tx));
 return tx;
end $$;
revoke all on function public.money_registration_bonus(uuid) from public,anon,authenticated;
grant execute on function public.money_registration_bonus(uuid) to service_role;
notify pgrst,'reload schema';
commit;
`;
fs.writeFileSync('database/19_purchase_wallet_registration_bonus.sql', head + [release,open,finish,fund,purchase].join('\n\n') + bonus);
console.log('Wrote migration 19. No database changes executed.');
