-- Live daily missions; old sandbox claims and balances are untouched.
begin;
set local lock_timeout='10s';
alter table public.money_transactions drop constraint if exists money_transactions_kind_check;
alter table public.money_transactions add constraint money_transactions_kind_check check(kind in ('deposit','withdrawal','investment_purchase','investment_return','referral_commission','registration_bonus','registration_bonus_reversal','daily_task_reward'));
create table if not exists public.money_daily_task_claims(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id),
 task_date date not null,
 threshold integer not null check(threshold in (5,10,20,30,50)),
 amount bigint not null check(amount>0),
 transaction_id uuid not null unique references public.money_transactions(id),
 created_at timestamptz not null default now(),
 unique(user_id,task_date,threshold)
);
alter table public.money_daily_task_claims enable row level security;
revoke all on public.money_daily_task_claims from public,anon,authenticated,service_role;
grant select on public.money_daily_task_claims to service_role;

create or replace function public.money_daily_tasks(p_user uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 with day as(select (now() at time zone 'Asia/Manila')::date d),
 active as(select count(distinct i.user_id) n from public.money_investments i
 join public.team_members t on t.id=i.user_id cross join day
 where t.invited_by=p_user and t.id<>p_user and i.acquisition='purchase'
 and i.created_at >= (day.d::timestamp at time zone 'Asia/Manila')
 and i.created_at < ((day.d+1)::timestamp at time zone 'Asia/Manila'))
 select jsonb_agg(jsonb_build_object('threshold',m.threshold,'reward',m.amount,
 'active_count',active.n,'task_date',day.d,
 'claimed',exists(select 1 from public.money_daily_task_claims c where c.user_id=p_user and c.task_date=day.d and c.threshold=m.threshold),
 'funded',coalesce((select available>=m.amount from public.money_business_budget where id=true),false)) order by m.threshold)
 from (values(5,5000),(10,10000),(20,25000),(30,40000),(50,150000)) m(threshold,amount) cross join active cross join day;
$$;

create or replace function public.money_daily_task_claim(p_user uuid,p_threshold integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare reward bigint; today date:=(now() at time zone 'Asia/Manila')::date; active bigint; tx uuid; previous public.money_daily_task_claims;
begin
 reward:=case p_threshold when 5 then 5000 when 10 then 10000 when 20 then 25000 when 30 then 40000 when 50 then 150000 end;
 if reward is null then raise exception 'Invalid daily task milestone';end if;
 perform 1 from public.money_business_budget where id=true for update;
 if not found then raise exception 'Insufficient funded business rewards budget';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 if not public.money_deposit_ready(p_user) then raise exception 'Account restricted';end if;
 select * into previous from public.money_daily_task_claims where user_id=p_user and task_date=today and threshold=p_threshold;
 if found then return jsonb_build_object('id',previous.transaction_id,'credited',0,'already_claimed',true);end if;
 select count(distinct i.user_id) into active from public.money_investments i
 join public.team_members t on t.id=i.user_id where t.invited_by=p_user and t.id<>p_user and i.acquisition='purchase'
 and i.created_at >= (today::timestamp at time zone 'Asia/Manila')
 and i.created_at < ((today+1)::timestamp at time zone 'Asia/Manila');
 if active<p_threshold then raise exception 'Daily task milestone is locked';end if;
 update public.money_business_budget set available=available-reward where id=true and available>=reward;
 if not found then raise exception 'Insufficient funded business rewards budget';end if;
 insert into public.money_transactions(user_id,kind,amount,method,status,idempotency_key)
 values(p_user,'daily_task_reward',reward,'internal','completed',gen_random_uuid()) returning id into tx;
 insert into public.money_wallets(user_id,available) values(p_user,reward)
 on conflict(user_id) do update set available=public.money_wallets.available+excluded.available;
 insert into public.money_ledger(user_id,transaction_id,action,available_delta,reserved_delta) values(p_user,tx,'daily_task_reward',reward,0);
 insert into public.money_daily_task_claims(user_id,task_date,threshold,amount,transaction_id) values(p_user,today,p_threshold,reward,tx);
 insert into public.money_business_ledger(action,subject_id,available_delta) values('daily_task_reward',tx,-reward);
 insert into public.money_audit(subject_id,action,details) values(tx,'daily_task_reward',jsonb_build_object('user_id',p_user,'task_date',today,'threshold',p_threshold,'active_count',active));
 return jsonb_build_object('id',tx,'credited',reward,'already_claimed',false);
end $$;
revoke all on function public.money_daily_tasks(uuid),public.money_daily_task_claim(uuid,integer) from public,anon,authenticated;
grant execute on function public.money_daily_tasks(uuid),public.money_daily_task_claim(uuid,integer) to service_role;
notify pgrst,'reload schema';
commit;
