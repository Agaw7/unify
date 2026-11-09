-- Extend the existing manual flow to verified GCash and Maya recipients. No balance changes or external transfers.
begin;
create or replace function public.money_record_manual_gotyme(p_id uuid,p_actor uuid,p_reference text,p_status text,p_confirm boolean)
returns void language plpgsql security definer set search_path='' as $$
declare t public.money_transactions; transfer_ref text;
begin
  select * into strict t from public.money_transactions where id=p_id for update;
  if p_actor is null or p_actor=t.user_id or not exists(select 1 from public.profiles where id=p_actor and role='admin') then
    raise exception 'Independent administrator required';
  end if;
  if t.kind<>'withdrawal' or t.method not in ('gotyme','gcash','maya') or t.withdrawal_mode<>'admin_approval'
    or p_reference is null or p_reference !~ '^[A-Z0-9-]{5,80}$'
    or p_status is null or p_status not in ('succeeded','failed')
    or p_confirm is distinct from true then raise exception 'Invalid manual transfer confirmation'; end if;
  transfer_ref := 'manual-'||t.method||':'||p_reference;
  if t.provider_reference is not null and t.provider_reference is distinct from transfer_ref then
    raise exception 'Withdrawal already linked to a different transfer';
  end if;
  if t.status in ('completed','failed') then
    perform public.money_settle(p_id,transfer_ref,p_status);
    return;
  end if;
  if t.status<>'processing' then raise exception 'Withdrawal must be claimed before recording transfer result'; end if;
  update public.money_transactions set provider_reference=transfer_ref where id=p_id;
  perform public.money_settle(p_id,transfer_ref,p_status);
  insert into public.money_audit(actor_id,subject_id,action,details)
    values(p_actor,p_id,'manual_transfer_result',jsonb_build_object('method',t.method,'reference',p_reference,'status',p_status));
end $$;
revoke all on function public.money_record_manual_gotyme(uuid,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.money_record_manual_gotyme(uuid,uuid,text,text,boolean) to service_role;
notify pgrst,'reload schema';
commit;
