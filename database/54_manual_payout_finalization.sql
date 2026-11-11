-- Record a verified manual transfer in one database transaction.
begin;
set local lock_timeout = '10s';

create function public.money_finalize_reviewed_manual_payout(
  p_id uuid, p_actor uuid, p_proof_path text, p_confirm boolean
) returns void language plpgsql security definer set search_path = '' as $$
declare
  payout_status text;
begin
  perform 1 from public.money_business_budget where id=true for update;
  select status into strict payout_status from public.money_transactions where id=p_id;
  if payout_status = 'approved' then
    perform public.money_claim_payout(p_id,p_actor);
  end if;
  perform public.money_confirm_manual_payout(p_id,p_actor,p_proof_path,p_confirm);
end $$;

revoke all on function public.money_finalize_reviewed_manual_payout(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.money_finalize_reviewed_manual_payout(uuid,uuid,text,boolean) to service_role;
notify pgrst,'reload schema';
commit;
