begin;

create function public.money_approve_gcash_deposit(p_id uuid, p_actor uuid, p_reference text)
returns void language plpgsql security definer set search_path='' as $$
declare
  deposit public.money_transactions;
  member_id uuid;
  payment_reference text := 'manual-qrph:gcash:' || p_reference;
begin
  select user_id into strict member_id from public.money_transactions where id=p_id;
  perform pg_advisory_xact_lock(hashtextextended(member_id::text,0));
  select * into strict deposit from public.money_transactions where id=p_id for update;
  if p_actor is null or p_actor=member_id
    or not exists (select 1 from public.profiles where id=p_actor and role='admin') then
    raise exception 'Independent administrator required';
  end if;
  if deposit.kind<>'deposit' or deposit.method<>'qrph' or deposit.payment_id is not null
    or deposit.checkout_url is not null or p_reference is null
    or not exists (select 1 from public.manual_qrph_deposits
      where transaction_id=p_id and instapay_reference='GCASH-' || p_reference) then
    raise exception 'Invalid GCash deposit';
  end if;
  if deposit.status='completed' and deposit.provider_reference=payment_reference then return; end if;
  if deposit.status<>'pending' or deposit.provider_reference is distinct from 'manual-qrph:' || p_id then
    raise exception 'Deposit is already linked or reviewed';
  end if;
  if exists (select 1 from public.money_transactions where provider_reference=payment_reference) then
    raise exception 'GCash reference already credited';
  end if;
  update public.money_transactions set provider_reference=payment_reference, reviewed_by=p_actor where id=p_id;
  perform public.money_credit(p_id,payment_reference,payment_reference,deposit.amount);
  perform public.money_release_hold(p_id,p_actor,payment_reference);
  insert into public.money_audit(actor_id,subject_id,action,details)
  values (p_actor,p_id,'manual_gcash_approved',jsonb_build_object('reference',p_reference));
end $$;

revoke all on function public.money_approve_gcash_deposit(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.money_approve_gcash_deposit(uuid,uuid,text) to service_role;
commit;
