-- Withdrawal-only identity review. No balance conversion or automatic settlement release.
begin;
create or replace function public.money_deposit_ready(p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users where id=p_user)
 and not exists(select 1 from public.money_customers where user_id=p_user and blocked)
 and not exists(select 1 from public.money_adjustments a join public.money_transactions t on t.id=a.transaction_id where t.user_id=p_user and a.kind='dispute' and a.status='open')
 and not exists(select 1 from public.money_wallets where user_id=p_user and debt>0)
 and not exists(select 1 from public.money_alerts a left join public.money_transactions t on t.id=a.transaction_id where not a.resolved and a.severity='critical' and (a.transaction_id is null or t.user_id=p_user))
$$;
revoke all on function public.money_deposit_ready(uuid) from public,anon,authenticated;
grant execute on function public.money_deposit_ready(uuid) to service_role;
create or replace function public.money_guard_transaction() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.kind='deposit' and tg_op='INSERT' and not public.money_deposit_ready(new.user_id) then raise exception 'Account restricted'; end if;
 if new.kind='withdrawal' and (tg_op='INSERT' or (new.status='processing' and old.status<>'processing'))
 and not public.money_customer_ready(new.user_id,new.destination_id) then raise exception 'Current identity/ownership approval required or account has a financial restriction'; end if;
 return new;
end $$;
create or replace function public.money_request(p_user uuid,p_kind text,p_amount bigint,p_method text,p_key uuid,p_destination uuid default null)
returns public.money_transactions language plpgsql security definer set search_path='' as $$
declare t public.money_transactions; d public.money_destinations; c public.money_customers;
begin
 -- Serialize requests and velocity checks per customer, including first-wallet creation.
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 select * into t from public.money_transactions where user_id=p_user and kind=p_kind and idempotency_key=p_key;
 if found then
  if t.amount<>p_amount or t.method<>p_method or t.destination_id is distinct from p_destination then raise exception 'Idempotency key conflict'; end if;
  return t;
 end if;
 select * into c from public.money_customers where user_id=p_user;
 if c.blocked then raise exception 'Account restricted'; end if;
 if p_kind='withdrawal' and (c.user_id is null or not c.verified) then raise exception 'Verified, unrestricted customer required'; end if;
 if p_kind='deposit' then
  insert into public.money_customers(user_id) values(p_user) on conflict do nothing;
 end if;
 if p_kind not in ('deposit','withdrawal') or p_amount is null or p_amount<10000 or p_amount>5000000
    or p_method is null or (p_kind='deposit' and p_method<>'qrph') or (p_kind='withdrawal' and p_method not in ('gcash','maya')) or p_key is null then raise exception 'Invalid money request'; end if;
 if p_kind='deposit' and (p_amount<20000 or p_destination is not null) then raise exception 'Invalid deposit'; end if;
 if (select count(*) from public.money_transactions where user_id=p_user and created_at>now()-interval '1 hour')>=10 then raise exception 'Hourly request limit reached'; end if;
 if (select coalesce(sum(amount),0) from public.money_transactions where user_id=p_user and kind=p_kind and created_at>now()-interval '24 hours' and status not in ('rejected','failed'))+p_amount>10000000 then raise exception 'Daily amount limit reached'; end if;
 insert into public.money_wallets(user_id) values(p_user) on conflict do nothing;
 if p_kind='withdrawal' then
  select * into d from public.money_destinations where id=p_destination and user_id=p_user and verified for share;
  if not found or d.method<>p_method or d.bic is null then raise exception 'Verified destination required'; end if;
  update public.money_wallets set available=available-p_amount,reserved=reserved+p_amount where user_id=p_user and available>=p_amount;
  if not found then raise exception 'Insufficient available balance'; end if;
 end if;
 insert into public.money_transactions(user_id,kind,amount,method,idempotency_key,destination_id,destination_snapshot,status)
 values(p_user,p_kind,p_amount,p_method,p_key,p_destination,
 case when p_kind='withdrawal' then jsonb_build_object('number',d.account_number,'name',d.account_name,'bic',d.bic) end,
 case when p_kind='withdrawal' then 'reserved' else 'pending' end) returning * into t;
 if p_kind='withdrawal' then
  insert into public.money_ledger(user_id,transaction_id,action,available_delta,reserved_delta) values(p_user,t.id,'reserve',-p_amount,p_amount);
 end if;
 insert into public.money_audit(actor_id,subject_id,action) values(p_user,t.id,'request_'||p_kind);
 return t;
end $$;
revoke all on function public.money_request(uuid,text,bigint,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.money_request(uuid,text,bigint,text,uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
