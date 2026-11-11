-- Commission source is the completed tier purchase. Legacy deposit rows retain their source.
begin;
set local lock_timeout = '10s';

alter table public.money_referral_commissions
  alter column deposit_id drop not null,
  add column purchase_id uuid references public.money_transactions(id),
  add constraint money_referral_commissions_one_source
    check ((deposit_id is null) <> (purchase_id is null)),
  add unique (purchase_id, level),
  add unique (purchase_id, beneficiary_id);

create index money_referral_purchase_pending_idx
  on public.money_referral_commissions (created_at, id)
  where purchase_id is not null and status = 'pending';

create function public.money_pay_purchase_commissions(p_purchase uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  commission public.money_referral_commissions;
  credit_id uuid;
  paid_count integer := 0;
begin
  perform 1 from public.money_business_budget where id = true for update;
  if not found then return 0; end if;

  for commission in
    select c.* from public.money_referral_commissions c
    where c.purchase_id is not null and c.status = 'pending'
      and (p_purchase is null or c.purchase_id = p_purchase)
      and public.money_deposit_ready(c.beneficiary_id)
      and c.amount <= (select available from public.money_business_budget where id = true)
    order by c.created_at, c.purchase_id, c.level
    limit 100 for update
  loop
    update public.money_business_budget set available = available - commission.amount
      where id = true and available >= commission.amount;
    if not found then continue; end if;

    insert into public.money_transactions(user_id, kind, amount, method, status, idempotency_key)
      values (commission.beneficiary_id, 'referral_commission', commission.amount, 'internal', 'completed', commission.id)
      returning id into credit_id;
    insert into public.money_wallets(user_id, available) values (commission.beneficiary_id, commission.amount)
      on conflict(user_id) do update set available = public.money_wallets.available + excluded.available;
    insert into public.money_ledger(user_id, transaction_id, action, available_delta, reserved_delta)
      values (commission.beneficiary_id, credit_id, 'referral_commission', commission.amount, 0);
    insert into public.money_business_ledger(action, subject_id, available_delta)
      values ('referral_commission', commission.id, -commission.amount);
    update public.money_referral_commissions set status = 'paid', transaction_id = credit_id
      where id = commission.id;
    insert into public.money_audit(subject_id, action, details)
      values (commission.id, 'purchase_referral_credited',
        jsonb_build_object('purchase_id', commission.purchase_id, 'credit_id', credit_id, 'level', commission.level));
    paid_count := paid_count + 1;
  end loop;
  return paid_count;
end $$;

create function public.money_accrue_purchase_commissions(p_investment uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  purchase public.money_transactions;
  current_member uuid;
  referrer uuid;
  visited uuid[];
  tier integer;
  share bigint;
begin
  perform 1 from public.money_business_budget where id = true for update;
  select t.* into strict purchase
  from public.money_investments i
  join public.money_transactions t on t.user_id = i.user_id and t.idempotency_key = i.idempotency_key
  where i.id = p_investment and i.acquisition = 'purchase'
    and t.kind = 'investment_purchase' and t.status = 'completed' and t.amount = i.price;

  current_member := purchase.user_id;
  visited := array[current_member];
  for tier in 1..3 loop
    select invited_by into referrer from public.team_members where id = current_member;
    exit when referrer is null or referrer = any(visited);
    visited := array_append(visited, referrer);
    share := floor(purchase.amount::numeric * (case tier when 1 then 18 when 2 then 3 else 1 end) / 100)::bigint;
    if share > 0 then
      insert into public.money_referral_commissions(purchase_id, beneficiary_id, depositor_id, level, amount)
        values (purchase.id, referrer, purchase.user_id, tier, share) on conflict do nothing;
    end if;
    current_member := referrer;
  end loop;

  perform public.money_pay_purchase_commissions(purchase.id);
end $$;

create function public.money_purchase_commission_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.money_accrue_purchase_commissions(new.subject_id);
  return new;
end $$;

-- This entry is written by the purchase function after reserving the plan rewards.
create trigger money_accrue_purchase_commission
  after insert on public.money_business_ledger for each row
  when (new.action = 'purchase')
  execute function public.money_purchase_commission_trigger();

-- Existing treasury entry point now retries purchase commissions only.
create or replace function public.money_referrals_backfill()
returns integer language sql security definer set search_path = '' as $$
  select public.money_pay_purchase_commissions();
$$;

revoke all on function public.money_accrue_purchase_commissions(uuid),
  public.money_pay_purchase_commissions(uuid), public.money_purchase_commission_trigger()
  from public, anon, authenticated, service_role;
grant execute on function public.money_pay_purchase_commissions(uuid) to service_role;
revoke execute on function public.money_referrals_process(uuid) from service_role;

notify pgrst, 'reload schema';
commit;
