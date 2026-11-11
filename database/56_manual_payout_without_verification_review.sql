-- Manual payout confirmation uses the saved recipient and verified transfer proof.
-- Existing automatic and legacy payout paths retain their own eligibility rules.
begin;
set local lock_timeout = '10s';

do $migration$
declare
  definition text := pg_get_functiondef('public.money_confirm_reviewed_payout_internal(uuid,uuid,text,boolean)'::regprocedure);
begin
  if strpos(definition, 't.status<>''processing''') = 0 then
    raise exception 'Unexpected manual payout confirmation definition';
  end if;
  execute replace(definition, 't.status<>''processing''', 't.status not in (''approved'',''processing'')');
end $migration$;

create or replace function public.money_finalize_mfa_manual_payout(
  p_id uuid, p_actor uuid, p_proof_path text, p_confirm boolean
) returns void language plpgsql security definer set search_path = '' as $$
declare
  t public.money_transactions;
  member_id uuid;
begin
  perform 1 from public.money_business_budget where id=true for update;
  select user_id into strict member_id from public.money_transactions where id=p_id;
  perform pg_advisory_xact_lock(hashtextextended(member_id::text,0));
  select * into strict t from public.money_transactions where id=p_id for update;
  if t.status not in ('approved','processing') or t.reviewed_by is null
     or t.kind <> 'withdrawal' or t.withdrawal_mode <> 'admin_approval'
     or t.method not in ('gotyme','gcash','maya') then
    raise exception 'Invalid manual payout confirmation';
  end if;
  if p_actor is null or p_actor=t.user_id
     or not exists(select 1 from public.profiles where id=p_actor and role='admin') then
    raise exception 'Independent payout administrator required';
  end if;
  if not public.money_deposit_ready(t.user_id) then
    raise exception 'Account restricted';
  end if;
  if not exists (
    select 1 from public.money_destinations d
    where d.id=t.destination_id and d.user_id=t.user_id and d.method=t.method
      and d.account_number=t.destination_snapshot->>'number'
      and d.account_name=t.destination_snapshot->>'name'
  ) then
    raise exception 'Withdrawal destination no longer matches the saved account';
  end if;
  perform public.money_confirm_reviewed_payout_internal(p_id,p_actor,p_proof_path,p_confirm);
end $$;

notify pgrst,'reload schema';
commit;
