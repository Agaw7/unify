begin;
set local lock_timeout='10s';

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('manual-deposit-receipts','manual-deposit-receipts',false,5242880,array['image/png','image/jpeg'])
on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=array['image/png','image/jpeg'];

drop policy if exists "Deny client access to manual deposit receipts" on storage.objects;
create policy "Deny client access to manual deposit receipts" on storage.objects
  as restrictive for all to anon,authenticated
  using (bucket_id <> 'manual-deposit-receipts')
  with check (bucket_id <> 'manual-deposit-receipts');

alter table public.manual_qrph_deposits
  alter column receipt drop not null,
  add column receipt_path text,
  add column has_receipt boolean generated always as (receipt is not null or receipt_path is not null) stored,
  add constraint manual_qrph_receipt_path_unique unique(receipt_path),
  add constraint manual_qrph_receipt_path_check check (
    receipt_path is null or receipt_path ~ ('^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f]{64}[.](png|jpg)$')
  ),
  add constraint manual_qrph_receipt_present_check check (receipt is not null or receipt_path is not null);

create function public.money_submit_manual_qrph_private(
  p_user uuid,p_amount bigint,p_key uuid,p_reference text,p_receipt_path text
)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  deposit public.money_transactions;
  existing public.manual_qrph_deposits;
begin
  if p_user is null or p_key is null or p_reference is null
    or p_reference !~ '^(PALAWAN|GCASH)-[A-Z0-9-]{5,72}$'
    or p_receipt_path is null
    or p_receipt_path !~ ('^'||p_user::text||'/'||p_key::text||'/[0-9a-f]{64}[.](png|jpg)$') then
    raise exception 'Invalid manual deposit request';
  end if;

  deposit := public.money_request(p_user,'deposit',p_amount,'qrph',p_key,null);
  select * into strict deposit from public.money_transactions where id=deposit.id for update;
  if deposit.checkout_url is not null
    or (deposit.provider_reference is not null and deposit.provider_reference is distinct from 'manual-qrph:'||deposit.id) then
    raise exception 'Deposit is already linked to another payment flow';
  end if;

  select * into existing from public.manual_qrph_deposits where transaction_id=deposit.id for update;
  if found then
    if existing.instapay_reference<>p_reference or existing.receipt_path is distinct from p_receipt_path then
      raise exception 'Manual deposit request details changed';
    end if;
    return deposit.id;
  end if;
  if deposit.status<>'pending' then raise exception 'Deposit is already being processed'; end if;

  insert into public.manual_qrph_deposits(transaction_id,instapay_reference,receipt,receipt_path)
  values(deposit.id,p_reference,null,p_receipt_path);
  update public.money_transactions set provider_reference='manual-qrph:'||deposit.id
    where id=deposit.id and status='pending' and provider_reference is null;
  if not found then raise exception 'Deposit request is no longer pending'; end if;
  return deposit.id;
end $$;

revoke all on function public.money_submit_manual_qrph_private(uuid,bigint,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.money_submit_manual_qrph_private(uuid,bigint,uuid,text,text)
  to service_role;

create function public.money_reject_manual_qrph(p_id uuid,p_actor uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare
  deposit public.money_transactions;
  payment public.manual_qrph_deposits;
begin
  select * into strict deposit from public.money_transactions where id=p_id for update;
  if p_actor is null or p_actor=deposit.user_id
    or not exists(select 1 from public.profiles where id=p_actor and role='admin') then
    raise exception 'Independent administrator required';
  end if;
  if p_reason is null or length(trim(p_reason)) not between 5 and 500 then
    raise exception 'Invalid rejection reason';
  end if;
  if deposit.kind<>'deposit' or deposit.method<>'qrph'
    or deposit.provider_reference is distinct from 'manual-qrph:'||deposit.id then
    raise exception 'Invalid manual deposit';
  end if;
  select * into strict payment from public.manual_qrph_deposits where transaction_id=p_id;
  if payment.instapay_reference !~ '^(PALAWAN|GCASH)-' then
    raise exception 'Unsupported manual deposit channel';
  end if;
  if deposit.status='rejected' then return; end if;
  if deposit.status<>'pending' then raise exception 'Deposit already reviewed'; end if;

  update public.money_transactions set status='rejected',reviewed_by=p_actor,updated_at=clock_timestamp()
    where id=p_id;
  insert into public.money_audit(actor_id,subject_id,action,details)
    values(p_actor,p_id,'manual_deposit_rejected',jsonb_build_object(
      'reason',trim(p_reason),'channel',split_part(payment.instapay_reference,'-',1)));
end $$;

revoke all on function public.money_reject_manual_qrph(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.money_reject_manual_qrph(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
