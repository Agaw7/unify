begin;
set local lock_timeout='10s';
-- Allow historical ₱30 grants and set ₱20 for future grants.
alter table public.money_registration_bonuses
 drop constraint money_registration_bonuses_amount_check,
 alter column amount set default 2000,
 add constraint money_registration_bonuses_amount_check check (amount in (2000,3000));

create or replace function public.money_registration_bonus(p_user uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare existing uuid; tx uuid;
begin
 perform 1 from public.money_business_budget where id=true for update;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 select transaction_id into existing from public.money_registration_bonuses where user_id=p_user;
 if found then return existing; end if;
 if p_user is null or not public.money_deposit_ready(p_user) then raise exception 'Account restricted'; end if;
 update public.money_business_budget set available=available-2000 where id=true and available>=2000;
 if not found then raise exception 'Registration bonus is awaiting business funding'; end if;
 insert into public.money_transactions(user_id,kind,amount,method,status,idempotency_key) values(p_user,'registration_bonus',2000,'internal','completed',gen_random_uuid()) returning id into tx;
 insert into public.money_wallets(user_id,available) values(p_user,2000) on conflict(user_id) do update set available=public.money_wallets.available+2000;
 insert into public.money_ledger(user_id,transaction_id,action,available_delta,reserved_delta) values(p_user,tx,'registration_bonus',2000,0);
 insert into public.money_registration_bonuses(user_id,transaction_id) values(p_user,tx);
 insert into public.money_business_ledger(action,subject_id,available_delta) values('registration_bonus',tx,-2000);
 insert into public.money_audit(subject_id,action,details) values(p_user,'registration_bonus',jsonb_build_object('amount',2000,'transaction',tx));
 return tx;
end $$;

create or replace function public.money_registration_bonuses_process(p_limit integer default 100)
returns integer language plpgsql security definer set search_path='' as $$
declare entry record; tx uuid; processed integer:=0;
begin
 if p_limit is null or p_limit<1 or p_limit>500 then raise exception 'Invalid bonus batch limit'; end if;
 perform 1 from public.money_business_budget where id=true for update;
 for entry in select user_id from public.money_registration_bonus_queue
 where status='pending' order by created_at,user_id limit p_limit for update skip locked loop
  exit when coalesce((select available from public.money_business_budget where id=true),0)<2000;
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
notify pgrst,'reload schema';
commit;
