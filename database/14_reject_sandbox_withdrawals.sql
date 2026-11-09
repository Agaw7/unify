begin;
alter table public.sandbox_withdrawal_requests
  add column if not exists rejection_reason text,
  add column if not exists rejected_at timestamptz,
  add column if not exists rejected_by uuid references public.profiles(id) on delete set null;

create or replace function public.reject_sandbox_withdrawal(p_admin uuid,p_request uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_request public.sandbox_withdrawal_requests%rowtype;
begin
  if not exists(select 1 from public.profiles where id=p_admin and role='admin') then
    raise exception 'Administrator required';
  end if;
  if p_reason is null or length(trim(p_reason)) not between 1 and 300 then
    raise exception 'Enter a rejection reason from 1 to 300 characters';
  end if;
  select * into v_request from public.sandbox_withdrawal_requests where id=p_request for update;
  if not found then raise exception 'Withdrawal not found'; end if;
  if v_request.status='rejected' then
    return jsonb_build_object('id',v_request.id,'status','rejected','replayed',true);
  end if;
  if v_request.status not in ('reserved','processing') then
    raise exception 'Only unpaid withdrawals can be rejected';
  end if;
  update public.sandbox_wallets set remaining_balance=remaining_balance+v_request.amount
    where user_id=v_request.user_id;
  if not found then raise exception 'Sandbox wallet not found'; end if;
  update public.sandbox_withdrawal_requests
    set status='rejected',rejection_reason=trim(p_reason),rejected_at=now(),rejected_by=p_admin
    where id=p_request;
  return jsonb_build_object('id',v_request.id,'status','rejected','replayed',false);
end $$;
revoke all on function public.reject_sandbox_withdrawal(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.reject_sandbox_withdrawal(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
