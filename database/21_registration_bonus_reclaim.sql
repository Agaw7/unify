-- Owner policy: manual admin reclaim only when neither deposit nor identity qualifies,
-- and the whole funded bonus is provably unspent. No external transfer.
begin;
set local lock_timeout='10s';
alter table public.money_registration_bonuses
 add column if not exists revoked_at timestamptz,
 add column if not exists revoked_by uuid references auth.users(id),
 add column if not exists reversal_transaction_id uuid unique references public.money_transactions(id),
 add column if not exists reclaim_reason text;
alter table public.money_transactions drop constraint if exists money_transactions_kind_check;
alter table public.money_transactions add constraint money_transactions_kind_check check(kind in ('deposit','withdrawal','investment_purchase','investment_return','referral_commission','registration_bonus','registration_bonus_reversal'));

create or replace function public.money_registration_bonus_eligibility(p_user uuid)
returns table(has_deposit boolean,has_identity boolean,unspent boolean)
language sql stable security definer set search_path='' as $$
 select
 exists(select 1 from public.money_transactions t where t.user_id=p_user and t.kind='deposit' and t.status='completed'),
 exists(select 1 from public.money_verifications v where v.user_id=p_user and v.kind='identity' and
  (v.status='approved' or exists(select 1 from public.money_audit a where a.subject_id=p_user and a.action='verification_approved' and a.details->>'verification_id'=v.id::text))),
 exists(select 1 from public.money_registration_bonuses b
  join public.money_wallets w on w.user_id=b.user_id
  join public.money_ledger l on l.transaction_id=b.transaction_id and l.action='registration_bonus' and l.available_delta=b.amount
  where b.user_id=p_user and b.revoked_at is null and w.available>=b.amount and w.reserved=0 and w.debt=0
  and not exists(select 1 from public.money_ledger spent where spent.user_id=p_user and spent.id>l.id and spent.available_delta<0))
$$;

create or replace function public.money_registration_bonus_reclaim(p_actor uuid,p_user uuid,p_key uuid,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare b public.money_registration_bonuses; eligible record; tx uuid;
begin
 if p_actor is null or not exists(select 1 from public.profiles where id=p_actor and role='admin') then raise exception 'Administrator required'; end if;
 if p_user is null or p_key is null or length(trim(coalesce(p_reason,''))) not between 5 and 300 then raise exception 'Valid member, request key and reclaim reason required'; end if;
 perform 1 from public.money_business_budget where id=true for update;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 select * into b from public.money_registration_bonuses where user_id=p_user for update;
 if not found then raise exception 'Registration bonus not found'; end if;
 if b.revoked_at is not null then return b.reversal_transaction_id; end if;
 perform 1 from public.money_wallets where user_id=p_user for update;
 select * into eligible from public.money_registration_bonus_eligibility(p_user);
 if eligible.has_deposit or eligible.has_identity then raise exception 'Member has a completed deposit or approved identity; bonus cannot be reclaimed'; end if;
 if not eligible.unspent then raise exception 'Bonus is spent, reserved, or has financial activity requiring review'; end if;
 update public.money_wallets set available=available-b.amount where user_id=p_user and available>=b.amount;
 if not found then raise exception 'Unspent bonus balance could not be confirmed'; end if;
 insert into public.money_transactions(user_id,kind,amount,method,status,idempotency_key)
 values(p_user,'registration_bonus_reversal',b.amount,'internal','completed',p_key) returning id into tx;
 insert into public.money_ledger(user_id,transaction_id,action,available_delta,reserved_delta) values(p_user,tx,'registration_bonus_reversal',-b.amount,0);
 update public.money_business_budget set available=available+b.amount where id=true;
 insert into public.money_business_ledger(action,subject_id,available_delta) values('registration_bonus_reversal',tx,b.amount);
 update public.money_registration_bonuses set revoked_at=now(),revoked_by=p_actor,reversal_transaction_id=tx,reclaim_reason=trim(p_reason) where user_id=p_user;
 insert into public.money_audit(actor_id,subject_id,action,details) values(p_actor,p_user,'registration_bonus_reclaimed',jsonb_build_object('amount',b.amount,'reason',trim(p_reason),'grant',b.transaction_id,'reversal',tx));
 return tx;
end $$;

create or replace function public.money_registration_bonus_overview(p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from public.profiles where id=p_actor and role='admin') then raise exception 'Administrator required'; end if;
 select coalesce(jsonb_agg(to_jsonb(item)),'[]'::jsonb) into result from (
  select b.user_id,right(u.phone,4) phone_last4,b.amount,b.created_at,b.revoked_at,b.reclaim_reason,
   e.has_deposit,e.has_identity,e.unspent,(b.revoked_at is null and not e.has_deposit and not e.has_identity and e.unspent) can_reclaim
  from public.money_registration_bonuses b join auth.users u on u.id=b.user_id
  cross join lateral public.money_registration_bonus_eligibility(b.user_id) e
  order by b.created_at desc,b.user_id limit 100
 ) item;
 return result;
end $$;
revoke all on function public.money_registration_bonus_eligibility(uuid),public.money_registration_bonus_reclaim(uuid,uuid,uuid,text),public.money_registration_bonus_overview(uuid) from public,anon,authenticated;
grant execute on function public.money_registration_bonus_eligibility(uuid),public.money_registration_bonus_reclaim(uuid,uuid,uuid,text),public.money_registration_bonus_overview(uuid) to service_role;
notify pgrst,'reload schema';
commit;
