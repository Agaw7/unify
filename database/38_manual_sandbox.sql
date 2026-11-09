begin;

create table public.manual_test_wallets (
  user_id uuid primary key references auth.users(id),
  available bigint not null default 0 check (available >= 0),
  reserved bigint not null default 0 check (reserved >= 0)
);
create table public.manual_test_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  request_key uuid not null,
  transaction_mode text not null default 'sandbox' check (transaction_mode='sandbox'),
  kind text not null check (kind in ('deposit','withdrawal')),
  amount bigint not null check (amount between 1 and 5000000),
  status text not null default 'pending' check (status in ('pending','approved','processing','completed','rejected','failed')),
  reference text,
  receipt text check (length(receipt)<=2800000),
  recipient_name text,
  recipient_number text,
  transfer_reference text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  reason text,
  created_at timestamptz not null default now(),
  unique (user_id, request_key)
);
create unique index manual_test_paid_reference on public.manual_test_requests(reference)
  where kind='deposit' and status='approved';
create unique index manual_test_transfer_reference on public.manual_test_requests(transfer_reference)
  where transfer_reference is not null;
create index manual_test_member_history on public.manual_test_requests(user_id, created_at desc);
create table public.manual_test_ledger (
  request_id uuid not null references public.manual_test_requests(id),
  action text not null,
  actor_id uuid not null references auth.users(id),
  available_delta bigint not null,
  reserved_delta bigint not null,
  created_at timestamptz not null default now(),
  primary key (request_id, action)
);
create table public.manual_test_audit (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.manual_test_requests(id),
  actor_id uuid not null references auth.users(id),
  action text not null,
  reason text,
  created_at timestamptz not null default now()
);
create table public.manual_test_settings (
  id boolean primary key default true check(id),
  enabled boolean not null default false,
  account_name text not null default '',
  qr_path text
);
insert into public.manual_test_settings default values;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('aurevia-test-qr','aurevia-test-qr',false,2000000,array['image/png','image/jpeg']);

alter table public.manual_test_wallets enable row level security;
alter table public.manual_test_requests enable row level security;
alter table public.manual_test_ledger enable row level security;
alter table public.manual_test_audit enable row level security;
alter table public.manual_test_settings enable row level security;
revoke all on public.manual_test_wallets,public.manual_test_requests,public.manual_test_ledger,public.manual_test_audit,public.manual_test_settings from public,anon,authenticated;
grant select on public.manual_test_wallets,public.manual_test_requests,public.manual_test_settings to service_role;
grant update on public.manual_test_settings to service_role;

create function public.manual_test_submit(p_user uuid,p_key uuid,p_kind text,p_amount bigint,
  p_reference text,p_receipt text,p_name text,p_number text)
returns uuid language plpgsql security definer set search_path='' as $$
declare r public.manual_test_requests;
begin
  if p_amount is null or p_amount not between 1 and 5000000 then raise exception 'Invalid amount'; end if;
  perform pg_advisory_xact_lock(hashtextextended('manual-test:'||p_user::text,0));
  select * into r from public.manual_test_requests where user_id=p_user and request_key=p_key;
  if found then
    if row(r.kind,r.amount,r.reference,r.receipt,r.recipient_name,r.recipient_number)
      is distinct from row(p_kind,p_amount,p_reference,p_receipt,p_name,p_number) then
      raise exception 'Request details changed';
    end if;
    return r.id;
  end if;
  if (select count(*) from public.manual_test_requests where user_id=p_user and created_at>now()-interval '1 hour')>=10 then
    raise exception 'Hourly request limit reached';
  end if;
  if p_kind='deposit' then
    if not exists(select 1 from public.manual_test_settings where enabled) then raise exception 'Test deposits disabled'; end if;
    if p_reference is null or p_reference !~ '^[A-Z0-9-]{5,80}$' then raise exception 'Invalid test payment reference'; end if;
  elsif p_kind='withdrawal' then
    if p_name is null or length(trim(p_name)) not between 2 and 100 or p_number is null or p_number !~ '^[0-9]{6,20}$' then
      raise exception 'Invalid test recipient';
    end if;
    update public.manual_test_wallets set available=available-p_amount,reserved=reserved+p_amount
      where user_id=p_user and available>=p_amount;
    if not found then raise exception 'Insufficient test balance'; end if;
  else
    raise exception 'Invalid request type';
  end if;
  insert into public.manual_test_requests(user_id,request_key,kind,amount,reference,receipt,recipient_name,recipient_number)
    values(p_user,p_key,p_kind,p_amount,p_reference,p_receipt,p_name,p_number) returning * into r;
  if p_kind='withdrawal' then
    insert into public.manual_test_ledger(request_id,action,actor_id,available_delta,reserved_delta)
      values(r.id,'reserve',p_user,-p_amount,p_amount);
  end if;
  insert into public.manual_test_audit(request_id,actor_id,action) values(r.id,p_user,'submit');
  return r.id;
end $$;

create function public.manual_test_review(p_admin uuid,p_id uuid,p_action text,p_reference text,p_reason text,p_confirm boolean)
returns void language plpgsql security definer set search_path='' as $$
declare r public.manual_test_requests; a bigint:=0; h bigint:=0;
begin
  if not exists(select 1 from public.profiles where id=p_admin and role='admin') then raise exception 'Administrator required'; end if;
  select * into strict r from public.manual_test_requests where id=p_id for update;
  if r.user_id=p_admin then raise exception 'Independent administrator required'; end if;
  if r.status=p_action then return; end if;
  if p_action='approved' and r.status='pending' then
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
  elsif (p_action='rejected' and r.status in ('pending','approved')) or
        (p_action='failed' and r.kind='withdrawal' and r.status='processing') then
    if r.kind='deposit' and r.status<>'pending' then raise exception 'Invalid review transition'; end if;
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

revoke all on function public.manual_test_submit(uuid,uuid,text,bigint,text,text,text,text),
  public.manual_test_review(uuid,uuid,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.manual_test_submit(uuid,uuid,text,bigint,text,text,text,text),
  public.manual_test_review(uuid,uuid,text,text,text,boolean) to service_role;
create function public.manual_test_admin_overview(p_admin uuid,p_search text,p_offset integer)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.profiles where id=p_admin and role='admin') then raise exception 'Administrator required'; end if;
  return jsonb_build_object(
    'members', coalesce((select jsonb_agg(m) from (
      select u.id,u.email,u.phone,p.role,coalesce(w.available,0) available,coalesce(w.reserved,0) reserved
      from auth.users u join public.profiles p on p.id=u.id
      left join public.manual_test_wallets w on w.user_id=u.id
      where u.deleted_at is null and strpos(lower(concat_ws(' ',u.id,u.email,u.phone)),lower(p_search))>0
      order by u.id offset greatest(p_offset,0) limit 51
    ) m),'[]'::jsonb),
    'summary', jsonb_build_object(
      'registered', (select count(*) from auth.users where deleted_at is null),
      'wallet', (select coalesce(sum(available+reserved),0) from public.manual_test_wallets),
      'approvedDeposits', (select coalesce(sum(amount),0) from public.manual_test_requests where kind='deposit' and status='approved'),
      'completedWithdrawals', (select coalesce(sum(amount),0) from public.manual_test_requests where kind='withdrawal' and status='completed'),
      'pendingDeposits', (select count(*) from public.manual_test_requests where kind='deposit' and status='pending'),
      'pendingWithdrawals', (select count(*) from public.manual_test_requests where kind='withdrawal' and status in ('pending','approved','processing')),
      'approved', (select count(*) from public.manual_test_audit where action='approved'),
      'rejected', (select count(*) from public.manual_test_requests where status='rejected')
    ));
end $$;
revoke all on function public.manual_test_admin_overview(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.manual_test_admin_overview(uuid,text,integer) to service_role;
commit;

