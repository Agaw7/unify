-- Requires migration 38. Test balances only; no live wallet references.
begin;
-- The admin reporting API may read test audit rows. All test financial writes
-- still run only inside the existing security-definer transaction functions.
revoke all on public.manual_test_wallets,public.manual_test_requests,public.manual_test_ledger,public.manual_test_audit from service_role;
grant select on public.manual_test_wallets,public.manual_test_requests,public.manual_test_ledger,public.manual_test_audit to service_role;
alter table public.manual_test_requests drop constraint manual_test_requests_status_check;
alter table public.manual_test_requests add constraint manual_test_requests_status_check
check(status in ('pending','under_review','approved','processing','completed','rejected','failed','reversed'));
drop index public.manual_test_paid_reference;
create unique index manual_test_paid_reference on public.manual_test_requests(reference)
where kind='deposit' and status in ('approved','reversed');
create or replace function public.manual_test_review(p_admin uuid,p_id uuid,p_action text,p_reference text,p_reason text,p_confirm boolean)
returns void language plpgsql security definer set search_path='' as $$
declare r public.manual_test_requests; a bigint:=0; h bigint:=0;
begin
  if not exists(select 1 from public.profiles where id=p_admin and role='admin') then raise exception 'Administrator required'; end if;
  select * into strict r from public.manual_test_requests where id=p_id for update;
  if r.user_id=p_admin then raise exception 'Independent administrator required'; end if;
  if r.status=p_action then return; end if;
  if p_action='under_review' and r.kind='deposit' and r.status='pending' then
    null;
  elsif p_action='reversed' and r.kind='deposit' and r.status='approved' then
    if p_confirm is distinct from true or length(trim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'Review reason required'; end if;
    a:=-r.amount;
  elsif p_action='approved' and r.status in ('pending','under_review') then
    if r.kind='deposit' then
      if p_confirm is distinct from true then raise exception 'Test verification confirmation required'; end if;
      a:=r.amount;
    end if;
  elsif r.kind='withdrawal' and p_action='processing' and r.status='approved' then
    null;
  elsif r.kind='withdrawal' and p_action='completed' and r.status='processing' then
    if p_confirm is distinct from true or p_reference is null or p_reference !~ '^[A-Z0-9-]{5,80}$' then
      raise exception 'Test transfer reference and confirmation required';
    end if;
    h:=-r.amount;
  elsif (p_action='rejected' and r.status in ('pending','under_review','approved')) or
        (p_action='failed' and r.kind='withdrawal' and r.status='processing') then
    if r.kind='deposit' and r.status not in ('pending','under_review') then raise exception 'Invalid review transition'; end if;
    if length(trim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'Review reason required'; end if;
    if r.kind='withdrawal' then a:=r.amount; h:=-r.amount; end if;
  else
    raise exception 'Invalid review transition';
  end if;

  if a<>0 or h<>0 then
    insert into public.manual_test_wallets(user_id) values(r.user_id) on conflict do nothing;
    update public.manual_test_wallets set available=available+a,reserved=reserved+h where user_id=r.user_id;
    insert into public.manual_test_ledger(request_id,action,actor_id,available_delta,reserved_delta)
      values(r.id,p_action,p_admin,a,h);
  end if;
  update public.manual_test_requests set status=p_action,reviewed_by=p_admin,reviewed_at=now(),reason=p_reason,
    transfer_reference=case when p_action='completed' then p_reference else null end where id=r.id;
  insert into public.manual_test_audit(request_id,actor_id,action,reason) values(r.id,p_admin,p_action,p_reason);
end $$;


create or replace function public.manual_test_admin_overview(p_admin uuid,p_search text,p_offset integer)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.profiles where id=p_admin and role='admin') then raise exception 'Administrator required'; end if;
  return jsonb_build_object(
    'members', coalesce((select jsonb_agg(m) from (
      select u.id,u.phone,p.role,coalesce(w.available,0) available,coalesce(w.reserved,0) reserved
      from auth.users u join public.profiles p on p.id=u.id
      left join public.manual_test_wallets w on w.user_id=u.id
      where u.deleted_at is null and strpos(lower(concat_ws(' ',u.id,u.phone)),lower(p_search))>0
      order by u.id offset greatest(p_offset,0) limit 51
    ) m),'[]'::jsonb),
    'summary', jsonb_build_object(
      'registered', (select count(*) from auth.users where deleted_at is null),
      'wallet', (select coalesce(sum(available+reserved),0) from public.manual_test_wallets),
      'approvedDeposits', (select coalesce(sum(amount),0) from public.manual_test_requests where kind='deposit' and status='approved'),
      'completedWithdrawals', (select coalesce(sum(amount),0) from public.manual_test_requests where kind='withdrawal' and status='completed'),
      'pendingDeposits', (select count(*) from public.manual_test_requests where kind='deposit' and status in ('pending','under_review')),
      'pendingWithdrawals', (select count(*) from public.manual_test_requests where kind='withdrawal' and status in ('pending','approved','processing')),
      'approved', (select count(*) from public.manual_test_audit where action='approved'),
      'rejected', (select count(*) from public.manual_test_requests where status='rejected')
    ));
end $$;
revoke all on function public.manual_test_admin_overview(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.manual_test_admin_overview(uuid,text,integer) to service_role;
commit;
