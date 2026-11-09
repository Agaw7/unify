-- Requires migration 19. Automatic funded bonus for NEW registrations only.
-- No existing accounts are enrolled by this migration.
begin;
set local lock_timeout='10s';
create table if not exists public.money_registration_bonus_queue (
 user_id uuid primary key references auth.users(id),
 status text not null default 'pending' check(status in ('pending','granted')),
 transaction_id uuid references public.money_transactions(id),
 last_error text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check((status='pending' and transaction_id is null) or (status='granted' and transaction_id is not null))
);
alter table public.money_registration_bonus_queue enable row level security;
revoke all on public.money_registration_bonus_queue from public,anon,authenticated,service_role;
grant select on public.money_registration_bonus_queue to service_role;

create or replace function public.money_registration_bonuses_process(p_limit integer default 100)
returns integer language plpgsql security definer set search_path='' as $$
declare entry record; tx uuid; processed integer:=0;
begin
 if p_limit is null or p_limit<1 or p_limit>500 then raise exception 'Invalid bonus batch limit'; end if;
 perform 1 from public.money_business_budget where id=true for update;
 for entry in select user_id from public.money_registration_bonus_queue
 where status='pending' order by created_at,user_id limit p_limit for update skip locked loop
  exit when coalesce((select available from public.money_business_budget where id=true),0)<3000;
  begin
   tx:=public.money_registration_bonus(entry.user_id);
   update public.money_registration_bonus_queue set status='granted',transaction_id=tx,last_error=null,updated_at=now() where user_id=entry.user_id;
   processed:=processed+1;
  exception when others then
   update public.money_registration_bonus_queue set last_error='Bonus awaiting account review',updated_at=now() where user_id=entry.user_id;
  end;
 end loop;
 return processed;
end $$;

create or replace function public.money_registration_bonus_on_signup()
returns trigger language plpgsql security definer set search_path='' as $$
declare tx uuid;
begin
 insert into public.money_registration_bonus_queue(user_id) values(new.id) on conflict(user_id) do nothing;
 begin
  tx:=public.money_registration_bonus(new.id);
  update public.money_registration_bonus_queue set status='granted',transaction_id=tx,last_error=null,updated_at=now() where user_id=new.id;
 exception when others then
  update public.money_registration_bonus_queue set last_error=case
   when sqlerrm like '%Registration bonus is awaiting business funding%' then 'Awaiting business funding'
   else 'Bonus awaiting account review' end,updated_at=now() where user_id=new.id;
 end;
 return new;
end $$;
drop trigger if exists money_registration_bonus_after_signup on auth.users;
create trigger money_registration_bonus_after_signup after insert on auth.users
for each row execute function public.money_registration_bonus_on_signup();

create or replace function public.money_registration_bonus_on_funding()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform public.money_registration_bonuses_process(500);
 return new;
end $$;
drop trigger if exists money_registration_bonus_after_funding on public.money_business_budget;
create trigger money_registration_bonus_after_funding after update of funded on public.money_business_budget
for each row when (new.funded>old.funded)
execute function public.money_registration_bonus_on_funding();

revoke all on function public.money_registration_bonuses_process(integer),public.money_registration_bonus_on_signup(),public.money_registration_bonus_on_funding() from public,anon,authenticated;
grant execute on function public.money_registration_bonuses_process(integer) to service_role;
notify pgrst,'reload schema';
commit;
