begin;

create table public.manual_qrph_deposits (
  transaction_id uuid primary key references public.money_transactions(id),
  instapay_reference text not null check (instapay_reference ~ '^[A-Z0-9-]{5,80}$'),
  receipt text not null check (length(receipt) <= 2800000)
);
alter table public.manual_qrph_deposits enable row level security;
revoke all on public.manual_qrph_deposits from public, anon, authenticated;
grant select on public.manual_qrph_deposits to service_role;

create function public.money_submit_manual_qrph(p_user uuid, p_amount bigint, p_key uuid, p_reference text, p_receipt text)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  deposit public.money_transactions;
begin
  deposit := public.money_request(p_user, 'deposit', p_amount, 'qrph', p_key, null);
  select * into strict deposit from public.money_transactions where id=deposit.id for update;
  if deposit.provider_reference is null and deposit.status <> 'pending' then
    raise exception 'Deposit is already being processed';
  end if;
  if deposit.checkout_url is not null or (
    deposit.provider_reference is not null and deposit.provider_reference not like 'manual-qrph:%'
  ) then raise exception 'Deposit is already linked to another payment flow'; end if;
  insert into public.manual_qrph_deposits(transaction_id, instapay_reference, receipt)
  values (deposit.id, p_reference, p_receipt)
  on conflict (transaction_id) do nothing;
  if not exists (select 1 from public.manual_qrph_deposits where transaction_id=deposit.id
    and instapay_reference=p_reference and receipt=p_receipt) then
    raise exception 'Manual deposit request details changed';
  end if;
  update public.money_transactions set provider_reference='manual-qrph:' || deposit.id
  where id=deposit.id and status='pending' and provider_reference is null;
  return deposit.id;
end $$;

create function public.money_verify_manual_qrph(p_id uuid, p_actor uuid, p_payment text)
returns void language plpgsql security definer set search_path='' as $$
declare
  deposit public.money_transactions;
  member_id uuid;
  payment_reference text := 'manual-qrph:' || p_payment;
begin
  select user_id into strict member_id from public.money_transactions where id=p_id;
  perform pg_advisory_xact_lock(hashtextextended(member_id::text,0));
  select * into strict deposit from public.money_transactions where id=p_id for update;
  if p_actor=member_id or not exists (select 1 from public.profiles where id=p_actor and role='admin') then
    raise exception 'Independent administrator required';
  end if;
  if deposit.kind<>'deposit' or deposit.method<>'qrph' or deposit.checkout_url is not null
    or p_payment is null or p_payment !~ '^pay_[A-Za-z0-9]+$'
    or not exists (select 1 from public.manual_qrph_deposits where transaction_id=p_id) then
    raise exception 'Invalid manual deposit';
  end if;
  if deposit.status='completed' and deposit.payment_id=p_payment then return; end if;
  if deposit.status<>'pending' or deposit.provider_reference is distinct from 'manual-qrph:' || deposit.id
    or deposit.payment_id is not null then
    raise exception 'Deposit is already linked or reviewed';
  end if;
  update public.money_transactions
  set payment_id=p_payment, provider_reference=payment_reference, reviewed_by=p_actor
  where id=p_id;
  perform public.money_credit(p_id, payment_reference, payment_reference, deposit.amount);
  insert into public.money_audit(actor_id, subject_id, action)
  values (p_actor, p_id, 'manual_qrph_verified');
end $$;

revoke all on function public.money_submit_manual_qrph(uuid,bigint,uuid,text,text),
  public.money_verify_manual_qrph(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.money_submit_manual_qrph(uuid,bigint,uuid,text,text),
  public.money_verify_manual_qrph(uuid,uuid,text) to service_role;
commit;
