-- Permit the reviewing administrator to record an externally verified payout
-- through the MFA-protected manual confirmation endpoint.
begin;
set local lock_timeout = '10s';

do $migration$
declare
  claim_definition text := pg_get_functiondef('public.money_claim_payout(uuid,uuid)'::regprocedure);
  confirm_definition text := pg_get_functiondef('public.money_confirm_manual_payout(uuid,uuid,text,boolean)'::regprocedure);
begin
  if strpos(claim_definition, ' or t.reviewed_by=p_actor') = 0
     or strpos(confirm_definition, ' or p_actor=t.reviewed_by') = 0 then
    raise exception 'Unexpected payout reviewer safeguards';
  end if;
  execute replace(replace(claim_definition, 'public.money_claim_payout(', 'public.money_claim_reviewed_payout_internal('), ' or t.reviewed_by=p_actor', '');
  execute replace(replace(confirm_definition, 'public.money_confirm_manual_payout(', 'public.money_confirm_reviewed_payout_internal('), ' or p_actor=t.reviewed_by', '');
end $migration$;

revoke all on function public.money_claim_reviewed_payout_internal(uuid,uuid),
  public.money_confirm_reviewed_payout_internal(uuid,uuid,text,boolean)
  from public,anon,authenticated,service_role;

create function public.money_finalize_mfa_manual_payout(
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
  if not public.money_customer_ready(t.user_id,t.destination_id)
     or not exists(select 1 from public.money_customers where user_id=t.user_id and verified and not blocked)
     or not exists(select 1 from public.money_destinations where id=t.destination_id and user_id=t.user_id and verified) then
    raise exception 'Customer or destination restricted';
  end if;
  if t.status='approved' then
    perform public.money_claim_reviewed_payout_internal(p_id,p_actor);
  end if;
  perform public.money_confirm_reviewed_payout_internal(p_id,p_actor,p_proof_path,p_confirm);
end $$;

revoke all on function public.money_finalize_mfa_manual_payout(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.money_finalize_mfa_manual_payout(uuid,uuid,text,boolean) to service_role;
notify pgrst,'reload schema';
commit;
