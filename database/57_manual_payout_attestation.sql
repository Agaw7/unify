-- Record an already-sent manual payout from an MFA-authenticated admin attestation.
-- Existing screenshot-backed records and their audit trail are retained.
begin;
set local lock_timeout = '10s';

do $$
begin
  if strpos(pg_get_functiondef('public.money_finalize_mfa_manual_payout(uuid,uuid,text,boolean)'::regprocedure),
    'Withdrawal destination no longer matches the saved account') = 0 then
    raise exception 'Apply migration 56 first';
  end if;
end $$;

alter table public.money_transactions drop constraint money_payout_proof_confirmation_check;
alter table public.money_transactions add constraint money_payout_proof_confirmation_check check (
  (payout_proof_path is null and payout_confirmed_by is null and payout_confirmed_at is null)
  or (kind='withdrawal' and status='completed'
    and payout_confirmed_by is not null and payout_confirmed_at is not null
    and (payout_proof_path is not null or provider_reference is not distinct from ('manual-attestation:'||id::text)))
);

create function public.money_attest_manual_payout(p_id uuid,p_actor uuid)
returns void language plpgsql security definer set search_path='' as $$
declare
  t public.money_transactions;
  member_id uuid;
  confirmation_time timestamptz;
  net_amount bigint;
  reference text;
  cash_account public.money_treasury_accounts;
begin
  perform 1 from public.money_business_budget where id=true for update;
  select user_id into strict member_id from public.money_transactions where id=p_id;
  perform pg_advisory_xact_lock(hashtextextended(member_id::text,0));
  select * into strict t from public.money_transactions where id=p_id for update;
  if p_actor is null or p_actor=t.user_id
     or not exists(select 1 from public.profiles where id=p_actor and role='admin') then
    raise exception 'Independent payout administrator required';
  end if;
  if t.kind<>'withdrawal' or t.withdrawal_mode<>'admin_approval' or t.method not in ('gotyme','gcash','maya') then
    raise exception 'Invalid manual payout confirmation';
  end if;
  reference:='manual-attestation:'||p_id::text;
  if t.status='completed' and t.provider_reference=reference then return; end if;
  if t.status not in ('approved','processing') or t.reviewed_by is null
     or t.provider_reference is not null or t.payout_confirmed_at is not null then
    raise exception 'Invalid manual payout confirmation';
  end if;
  if not public.money_deposit_ready(t.user_id) then raise exception 'Account restricted'; end if;
  if not exists (
    select 1 from public.money_destinations d
    where d.id=t.destination_id and d.user_id=t.user_id and d.method=t.method
      and d.account_number=t.destination_snapshot->>'number'
      and d.account_name=t.destination_snapshot->>'name'
  ) then raise exception 'Withdrawal destination no longer matches the saved account'; end if;

  confirmation_time:=clock_timestamp();
  net_amount:=t.amount-t.withdrawal_fee;
  update public.money_wallets set reserved=reserved-t.amount where user_id=t.user_id and reserved>=t.amount;
  if not found then raise exception 'Withdrawal reservation is missing'; end if;

  if t.method='gotyme' then
    select * into cash_account from public.money_treasury_accounts where id='gotyme' for update;
    if found and cash_account.reconciled_at is not null then
      perform public.money_treasury_post('gotyme','payout:'||p_id,'payout',p_id,-net_amount,
        reference,confirmation_time,p_actor,jsonb_build_object('net_sent',net_amount,'confirmation_type','admin_attestation'));
    end if;
  end if;

  update public.money_transactions set status='completed',provider_reference=reference,
    payout_confirmed_by=p_actor,payout_confirmed_at=confirmation_time,updated_at=confirmation_time where id=p_id;
  insert into public.money_ledger(user_id,transaction_id,action,available_delta,reserved_delta)
    values(t.user_id,p_id,'settle',0,-t.amount);
  insert into public.money_audit(actor_id,subject_id,action,details)
    values(p_actor,p_id,'manual_payout_attested',jsonb_build_object('method',t.method,'net_payout',net_amount,'fee',t.withdrawal_fee));
  perform public.money_treasury_check_shortfall();
end $$;

revoke all on function public.money_attest_manual_payout(uuid,uuid) from public,anon,authenticated;
grant execute on function public.money_attest_manual_payout(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
