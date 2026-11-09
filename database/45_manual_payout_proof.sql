begin;
set local lock_timeout='10s';

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('withdrawal-payout-proofs','withdrawal-payout-proofs',false,5242880,array['image/png','image/jpeg'])
on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=array['image/png','image/jpeg'];

drop policy if exists "Deny client access to payout proof images" on storage.objects;
create policy "Deny client access to payout proof images" on storage.objects
  as restrictive for all to anon,authenticated
  using (bucket_id <> 'withdrawal-payout-proofs')
  with check (bucket_id <> 'withdrawal-payout-proofs');

alter table public.money_transactions
  add column payout_proof_path text,
  add column payout_confirmed_by uuid references auth.users(id),
  add column payout_confirmed_at timestamptz,
  add constraint money_payout_proof_path_unique unique(payout_proof_path),
  add constraint money_payout_proof_confirmation_check check (
    (payout_proof_path is null and payout_confirmed_by is null and payout_confirmed_at is null)
    or (kind='withdrawal' and status='completed' and payout_proof_path is not null
      and payout_confirmed_by is not null and payout_confirmed_at is not null)
  );

create function public.money_confirm_manual_payout(p_id uuid,p_actor uuid,p_proof_path text,p_confirm boolean)
returns void language plpgsql security definer set search_path='' as $$
declare
  t public.money_transactions;
  w public.money_wallets;
  confirmed_at timestamptz:=clock_timestamp();
  payout_reference text;
  net_amount bigint;
  cash_account public.money_treasury_accounts;
begin
  perform 1 from public.money_business_budget where id=true for update;
  select * into strict t from public.money_transactions where id=p_id for update;
  if p_actor is null or not exists(select 1 from public.profiles where id=p_actor and role='admin')
    or p_actor=t.user_id or p_actor=t.reviewed_by then
    raise exception 'Independent payout administrator required';
  end if;
  if p_confirm is distinct from true or p_proof_path is null
    or p_proof_path !~ ('^'||p_id::text||'/[0-9a-f-]{36}[.](png|jpg)$')
    or t.kind<>'withdrawal' or t.method not in ('gotyme','gcash','maya')
    or t.withdrawal_mode<>'admin_approval' or t.status<>'processing'
    or t.payout_proof_path is not null or t.payout_confirmed_at is not null then
    raise exception 'Invalid manual payout confirmation';
  end if;

  select * into strict w from public.money_wallets where user_id=t.user_id for update;
  if w.reserved<t.amount then raise exception 'Withdrawal reservation is missing'; end if;
  net_amount:=t.amount-t.withdrawal_fee;
  payout_reference:='proof-'||p_id::text;

  if t.method='gotyme' then
    select * into cash_account from public.money_treasury_accounts where id='gotyme' for update;
    if found and cash_account.reconciled_at is not null then
      perform public.money_treasury_post('gotyme','payout:'||p_id,'payout',p_id,-net_amount,
        payout_reference,confirmed_at,p_actor,jsonb_build_object('net_sent',net_amount,'proof_path',p_proof_path,'confirmation_time',confirmed_at));
    end if;
  end if;

  update public.money_wallets set reserved=reserved-t.amount where user_id=t.user_id;
  update public.money_transactions set status='completed',
    provider_reference='manual-proof:'||p_id::text,
    payout_proof_path=p_proof_path,payout_confirmed_by=p_actor,payout_confirmed_at=confirmed_at,
    updated_at=confirmed_at
    where id=p_id;
  insert into public.money_ledger(user_id,transaction_id,action,available_delta,reserved_delta)
    values(t.user_id,p_id,'settle',0,-t.amount);
  insert into public.money_audit(actor_id,subject_id,action,details)
    values(p_actor,p_id,'manual_payout_confirmed',jsonb_build_object(
      'proof_path',p_proof_path,'method',t.method,'requested_amount',t.amount,
      'fee',t.withdrawal_fee,'net_payout',net_amount,'confirmed_at',confirmed_at));

  perform public.money_treasury_check_shortfall();
end $$;

revoke all on function public.money_confirm_manual_payout(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.money_confirm_manual_payout(uuid,uuid,text,boolean) to service_role;
notify pgrst,'reload schema';
commit;
