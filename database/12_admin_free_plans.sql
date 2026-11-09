begin;
alter table public.demo_investments add column if not exists acquisition_type text not null default 'purchase';
create table if not exists public.sandbox_free_plan_grants (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null unique references public.profiles(id),
 product_id uuid not null references public.investment_products(id),
 investment_id uuid not null unique references public.demo_investments(id),
 granted_by uuid not null references public.profiles(id),
 idempotency_key uuid not null,
 note text not null default '' check(length(note)<=300),
 created_at timestamptz not null default now(),
 unique(granted_by,idempotency_key)
);
alter table public.sandbox_free_plan_grants enable row level security;
revoke all on public.sandbox_free_plan_grants from public,anon,authenticated;
grant select on public.sandbox_free_plan_grants to authenticated;
grant select on public.sandbox_free_plan_grants to service_role;
drop policy if exists "Read own free plan grant" on public.sandbox_free_plan_grants;
create policy "Read own free plan grant" on public.sandbox_free_plan_grants for select to authenticated using(user_id=(select auth.uid()));

create or replace function public.grant_sandbox_free_plan(p_admin uuid,p_user uuid,p_product uuid,p_key uuid,p_note text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_existing public.sandbox_free_plan_grants%rowtype; v_price numeric; v_daily numeric; v_investment uuid; v_grant uuid;
begin
 if not exists(select 1 from public.profiles where id=p_admin and role='admin') then raise exception 'Administrator required'; end if;
 if p_user is null or p_product is null or p_key is null or p_note is null or length(p_note)>300 then raise exception 'Invalid free plan details'; end if;
 perform 1 from public.profiles where id=p_user and role='user' for update;
 if not found then raise exception 'Member account not found'; end if;
 select * into v_existing from public.sandbox_free_plan_grants where granted_by=p_admin and idempotency_key=p_key;
 if found then
  if v_existing.user_id<>p_user or v_existing.product_id<>p_product or v_existing.note<>p_note then raise exception 'Request key reused with different details'; end if;
  return jsonb_build_object('id',v_existing.id,'investment_id',v_existing.investment_id,'replayed',true);
 end if;
 if exists(select 1 from public.sandbox_free_plan_grants where user_id=p_user) then raise exception 'Member already received a free welcome plan'; end if;
 select price,daily_income into v_price,v_daily from public.investment_products where id=p_product;
 if not found or v_price<=0 or v_daily<0 or v_price is null or v_daily is null then raise exception 'Product unavailable'; end if;
 insert into public.demo_investments(user_id,product_id,amount,daily_income,acquisition_type)
 values(p_user,p_product,v_price,v_daily,'admin_free_plan') returning id into v_investment;
 insert into public.sandbox_free_plan_grants(user_id,product_id,investment_id,granted_by,idempotency_key,note)
 values(p_user,p_product,v_investment,p_admin,p_key,p_note) returning id into v_grant;
 return jsonb_build_object('id',v_grant,'investment_id',v_investment,'replayed',false);
end; $$;
revoke all on function public.grant_sandbox_free_plan(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.grant_sandbox_free_plan(uuid,uuid,uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
