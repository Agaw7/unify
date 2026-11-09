begin;
create table if not exists public.sandbox_withdrawal_settings (
 id boolean primary key default true check(id),
 mode text not null default 'admin_approval' check(mode in ('automatic','admin_approval')),
 version integer not null default 1,
 updated_by uuid references public.profiles(id),
 updated_at timestamptz not null default now()
);
insert into public.sandbox_withdrawal_settings(id) values(true) on conflict do nothing;
create table if not exists public.sandbox_withdrawal_mode_audit (
 id uuid primary key default gen_random_uuid(),actor_id uuid not null references public.profiles(id),
 previous_mode text not null,new_mode text not null,version integer not null unique,created_at timestamptz not null default now()
);
alter table public.sandbox_withdrawal_settings enable row level security;
alter table public.sandbox_withdrawal_mode_audit enable row level security;
revoke all on public.sandbox_withdrawal_settings,public.sandbox_withdrawal_mode_audit from public,anon,authenticated;
grant select on public.sandbox_withdrawal_settings,public.sandbox_withdrawal_mode_audit to service_role;
alter table public.sandbox_withdrawal_requests add column if not exists processing_mode text not null default 'admin_approval'
 check(processing_mode in ('automatic','admin_approval'));

create or replace function public.set_sandbox_withdrawal_mode(p_admin uuid,p_mode text,p_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.sandbox_withdrawal_settings%rowtype;
begin
 if not exists(select 1 from public.profiles where id=p_admin and role='admin') then raise exception 'Administrator required'; end if;
 if p_mode is null or p_mode not in ('automatic','admin_approval') or p_version is null then raise exception 'Invalid withdrawal mode'; end if;
 select * into strict v from public.sandbox_withdrawal_settings where id=true for update;
 if v.version<>p_version then raise exception 'Settings changed. Refresh before saving'; end if;
 if v.mode<>p_mode then
  insert into public.sandbox_withdrawal_mode_audit(actor_id,previous_mode,new_mode,version) values(p_admin,v.mode,p_mode,v.version+1);
  update public.sandbox_withdrawal_settings set mode=p_mode,version=version+1,updated_by=p_admin,updated_at=now() where id=true returning * into v;
 end if;
 return to_jsonb(v);
end; $$;
revoke all on function public.set_sandbox_withdrawal_mode(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.set_sandbox_withdrawal_mode(uuid,text,integer) to service_role;

-- Only the authenticated server route can supply user ID and the environment
-- gate. The old client RPC is revoked so callers cannot bypass the saved mode.
revoke all on function public.request_sandbox_withdrawal(numeric,uuid,uuid) from public,anon,authenticated;
create or replace function public.request_configured_sandbox_withdrawal(p_user uuid,p_amount numeric,p_account uuid,p_key uuid,p_simulation_enabled boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_balance numeric; v_method text; v_mode text; v_status text; v_id uuid;
 v_existing public.sandbox_withdrawal_requests%rowtype;
begin
 if p_user is null then raise exception 'Authentication required'; end if;
 if p_amount is null or p_amount<100 or p_amount>50000 or p_amount<>round(p_amount,2) or p_account is null or p_key is null then raise exception 'Invalid withdrawal details'; end if;
 select provider into v_method from public.payment_accounts where id=p_account and user_id=p_user;
 if v_method is null or v_method not in ('gcash','maya') then raise exception 'Select a valid saved GCash or Maya account'; end if;
 select remaining_balance into v_balance from public.sandbox_wallets where user_id=p_user for update;
 if not found then raise exception 'Sandbox wallet not found'; end if;
 select * into v_existing from public.sandbox_withdrawal_requests where user_id=p_user and idempotency_key=p_key;
 if found then
  if v_existing.amount<>p_amount or v_existing.payment_account_id is distinct from p_account then raise exception 'Request key reused with different details'; end if;
  return jsonb_build_object('id',v_existing.id,'status',v_existing.status,'processing_mode',v_existing.processing_mode,'remaining_balance',v_balance,'replayed',true);
 end if;
 select mode into strict v_mode from public.sandbox_withdrawal_settings where id=true for share;
 if v_mode='automatic' and p_simulation_enabled is not true then raise exception 'Automatic sandbox simulation is disabled'; end if;
 if v_balance<p_amount then raise exception 'Insufficient simulated Remaining Balance'; end if;
 v_status:=case when v_mode='automatic' then 'simulated_paid' else 'reserved' end;
 update public.sandbox_wallets set remaining_balance=remaining_balance-p_amount where user_id=p_user;
 insert into public.sandbox_withdrawal_requests(user_id,amount,currency,status,payment_method,payment_account_id,idempotency_key,processing_mode)
 values(p_user,p_amount,'PHP',v_status,v_method,p_account,p_key,v_mode) returning id into v_id;
 return jsonb_build_object('id',v_id,'status',v_status,'processing_mode',v_mode,'remaining_balance',v_balance-p_amount,'replayed',false);
end; $$;
revoke all on function public.request_configured_sandbox_withdrawal(uuid,numeric,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.request_configured_sandbox_withdrawal(uuid,numeric,uuid,uuid,boolean) to service_role;
notify pgrst,'reload schema';
commit;
