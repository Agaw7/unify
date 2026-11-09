begin;
set local lock_timeout = '10s';

alter table public.money_transactions drop constraint money_transactions_kind_check;
alter table public.money_transactions add constraint money_transactions_kind_check check (kind in (
  'deposit','withdrawal','investment_purchase','investment_return','referral_commission',
  'registration_bonus','registration_bonus_reversal','daily_task_reward','check_in_reward','gift_code_reward','admin_balance_grant'
));

create table public.money_gift_codes (
  code_hash text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id),
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  max_claims integer not null check (max_claims between 1 and 100)
);
create table public.money_promo_claims (
  user_id uuid not null references auth.users(id),
  kind text not null check (kind in ('check_in_reward','gift_code_reward')),
  claim_key text not null,
  transaction_id uuid not null unique references public.money_transactions(id),
  amount bigint not null check (amount > 0),
  primary key (user_id,kind,claim_key)
);
alter table public.money_gift_codes enable row level security;
alter table public.money_promo_claims enable row level security;
revoke all on public.money_gift_codes, public.money_promo_claims from public, anon, authenticated, service_role;
grant insert on public.money_gift_codes to service_role;

create function public.money_check_in_status(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.money_promo_claims
    where user_id=p_user and kind='check_in_reward'
    and claim_key=((now() at time zone 'Asia/Manila')::date)::text);
$$;

create function public.money_claim_promo(p_user uuid,p_kind text,p_code_hash text default null,p_gift_amount bigint default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_key text;
  v_amount bigint;
  v_required bigint;
  v_tx uuid;
  v_code public.money_gift_codes;
  v_prior public.money_promo_claims;
begin
  if p_kind='check_in_reward' then
    v_key:=((now() at time zone 'Asia/Manila')::date)::text;
    v_amount:=500;
    v_required:=500;
  elsif p_kind='gift_code_reward' and p_code_hash ~ '^[0-9a-f]{64}$'
      and p_gift_amount between 100 and 1000 and p_gift_amount % 100 = 0 then
    v_key:=p_code_hash;
    v_amount:=p_gift_amount;
    v_required:=1000;
  else
    raise exception 'Invalid reward request';
  end if;

  perform 1 from public.money_business_budget where id=true for update;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
  if not public.money_deposit_ready(p_user) then raise exception 'Account restricted'; end if;
  select * into v_prior from public.money_promo_claims where user_id=p_user and kind=p_kind and claim_key=v_key;
  if found then return jsonb_build_object('alreadyClaimed',true,'amount',v_prior.amount); end if;

  if p_kind='gift_code_reward' then
    select * into v_code from public.money_gift_codes where code_hash=v_key for update;
    if not found or v_code.expires_at <= clock_timestamp() then raise exception 'Invalid or expired gift code'; end if;
    if (select count(*) from public.money_promo_claims where kind=p_kind and claim_key=v_key) >= v_code.max_claims then
      raise exception 'Gift code is fully claimed';
    end if;
  end if;

  update public.money_business_budget set available=available-v_amount where id=true and available>=v_required;
  if not found then raise exception 'Insufficient funded business rewards budget'; end if;
  insert into public.money_transactions(user_id,kind,amount,method,status,idempotency_key)
    values(p_user,p_kind,v_amount,'internal','completed',gen_random_uuid()) returning id into v_tx;
  insert into public.money_wallets(user_id,available) values(p_user,v_amount)
    on conflict(user_id) do update set available=public.money_wallets.available+excluded.available;
  insert into public.money_ledger(user_id,transaction_id,action,available_delta,reserved_delta)
    values(p_user,v_tx,p_kind,v_amount,0);
  insert into public.money_business_ledger(action,subject_id,available_delta) values(p_kind,v_tx,-v_amount);
  insert into public.money_promo_claims(user_id,kind,claim_key,transaction_id,amount) values(p_user,p_kind,v_key,v_tx,v_amount);
  return jsonb_build_object('alreadyClaimed',false,'amount',v_amount);
end $$;

revoke all on function public.money_check_in_status(uuid), public.money_claim_promo(uuid,text,text,bigint) from public,anon,authenticated;
grant execute on function public.money_check_in_status(uuid), public.money_claim_promo(uuid,text,text,bigint) to service_role;
notify pgrst,'reload schema';
commit;
