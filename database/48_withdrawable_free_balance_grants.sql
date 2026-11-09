begin;
set local lock_timeout = '10s';

alter table public.money_transactions drop constraint if exists money_transactions_kind_check;
alter table public.money_transactions add constraint money_transactions_kind_check check (kind in (
  'deposit','withdrawal','investment_purchase','investment_return','referral_commission',
  'registration_bonus','registration_bonus_reversal','daily_task_reward','check_in_reward',
  'gift_code_reward','admin_balance_grant'
));

create table public.money_admin_balance_grants (
  idempotency_key uuid primary key,
  actor_id uuid not null references auth.users(id),
  user_ids uuid[] not null check (cardinality(user_ids) between 1 and 50),
  amount bigint not null check (amount in (100000, 150000)),
  reason text not null check (length(reason) between 5 and 300),
  created_at timestamptz not null default now()
);
alter table public.money_admin_balance_grants enable row level security;
revoke all on public.money_admin_balance_grants from public, anon, authenticated, service_role;

create function public.money_admin_grant_balance(
  p_actor uuid,
  p_user_ids uuid[],
  p_amount bigint,
  p_key uuid,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_budget public.money_business_budget;
  v_prior public.money_admin_balance_grants;
  v_user uuid;
  v_transaction uuid;
  v_total bigint;
  v_count integer;
begin
  if not exists(select 1 from public.profiles where id=p_actor and role='admin') then
    raise exception 'Administrator required';
  end if;
  if p_key is null or p_user_ids is null or cardinality(p_user_ids) not between 1 and 50
      or p_amount not in (100000, 150000)
      or length(trim(coalesce(p_reason,''))) not between 5 and 300 then
    raise exception 'Invalid balance grant';
  end if;
  if cardinality(p_user_ids)<>(select count(distinct member_id) from unnest(p_user_ids) as member_id) then
    raise exception 'Duplicate member selection';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_key::text,0));
  select * into v_budget from public.money_business_budget where id=true for update;
  if not found then raise exception 'Reward budget unavailable'; end if;

  select * into v_prior from public.money_admin_balance_grants where idempotency_key=p_key;
  if found then
    if v_prior.actor_id<>p_actor or v_prior.user_ids<>p_user_ids
        or v_prior.amount<>p_amount or v_prior.reason<>trim(p_reason) then
      raise exception 'Idempotency key conflict';
    end if;
    return jsonb_build_object('alreadyGranted',true,'count',cardinality(p_user_ids),'amount',p_amount);
  end if;

  for v_user in select member_id from unnest(p_user_ids) as member_id order by member_id loop
    perform pg_advisory_xact_lock(hashtextextended(v_user::text,0));
  end loop;

  select count(*) into v_count from public.profiles
    where id=any(p_user_ids) and role='user';
  if v_count<>cardinality(p_user_ids) then raise exception 'Member not found or ineligible'; end if;
  if exists(select 1 from unnest(p_user_ids) as member_id where not public.money_deposit_ready(member_id)) then
    raise exception 'Account restricted';
  end if;

  v_total:=p_amount*cardinality(p_user_ids);
  update public.money_business_budget set available=available-v_total
    where id=true and available>=v_total;
  if not found then raise exception 'Insufficient funded business rewards budget'; end if;

  insert into public.money_admin_balance_grants(idempotency_key,actor_id,user_ids,amount,reason)
    values(p_key,p_actor,p_user_ids,p_amount,trim(p_reason));

  for v_user in select member_id from unnest(p_user_ids) as member_id order by member_id loop
    insert into public.money_transactions(user_id,kind,amount,method,status,idempotency_key)
      values(v_user,'admin_balance_grant',p_amount,'internal','completed',p_key)
      returning id into v_transaction;
    insert into public.money_wallets(user_id,available)
      values(v_user,p_amount)
      on conflict(user_id) do update set available=public.money_wallets.available+excluded.available;
    insert into public.money_ledger(user_id,transaction_id,action,available_delta,reserved_delta)
      values(v_user,v_transaction,'admin_balance_grant',p_amount,0);
    insert into public.money_business_ledger(action,subject_id,available_delta)
      values('admin_balance_grant',v_transaction,-p_amount);
    insert into public.money_audit(actor_id,subject_id,action,details)
      values(p_actor,v_transaction,'admin_balance_grant',
        jsonb_build_object('member',v_user,'amount',p_amount,'reason',trim(p_reason),'grant_key',p_key));
  end loop;

  return jsonb_build_object('alreadyGranted',false,'count',cardinality(p_user_ids),'amount',p_amount);
end $$;

revoke all on function public.money_admin_grant_balance(uuid,uuid[],bigint,uuid,text) from public,anon,authenticated;
grant execute on function public.money_admin_grant_balance(uuid,uuid[],bigint,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
