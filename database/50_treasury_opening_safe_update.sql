-- Scope the opening update for Supabase API sessions with safeupdate enabled.
begin;
set local lock_timeout = '10s';

create or replace function public.money_treasury_open(p_actor uuid,p_palawan bigint,p_gotyme bigint,p_key uuid,p_reference text,p_at timestamptz,p_allocate boolean,p_confirm boolean,p_allocation_limit bigint default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.money_treasury_accounts; prior public.money_treasury_entries; s jsonb; allocation bigint:=0;
begin
 if p_actor is null or not exists(select 1 from public.profiles where id=p_actor and role='admin') then raise exception 'Administrator required'; end if;
 if p_confirm is distinct from true or p_palawan is null or p_gotyme is null or p_palawan<0 or p_gotyme<0 or p_palawan>100000000000 or p_gotyme>100000000000 or p_key is null or length(trim(coalesce(p_reference,''))) not between 5 and 100 or p_at is null or p_at>clock_timestamp()+interval '1 minute' or p_at<clock_timestamp()-interval '1 hour' then raise exception 'Confirm recent opening balances and statement reference'; end if;
 perform 1 from public.money_business_budget where id=true for update;
 perform 1 from public.money_treasury_accounts order by id for update;
 if exists(select 1 from public.money_treasury_accounts where reconciled_at is not null) then
  select * into prior from public.money_treasury_entries where account_id='palawan' and entry_key='opening:'||p_key;
  if found and prior.delta=p_palawan and prior.reference=p_reference and prior.occurred_at=p_at and prior.details=jsonb_build_object('allocate',p_allocate,'allocation_limit',p_allocation_limit) and exists(select 1 from public.money_treasury_entries where account_id='gotyme' and entry_key='opening:'||p_key and delta=p_gotyme) then return public.money_treasury_summary(); end if;
  raise exception 'Opening balances are already recorded; use reconciliation';
 end if;
 update public.money_treasury_accounts set reconciled_at=p_at,confirmed_by=p_actor,reference=p_reference,updated_at=now()
 where id in ('palawan','gotyme') and reconciled_at is null;
 perform public.money_treasury_post('palawan','opening:'||p_key,'opening',null,p_palawan,p_reference,p_at,p_actor,jsonb_build_object('allocate',p_allocate,'allocation_limit',p_allocation_limit));
 perform public.money_treasury_post('gotyme','opening:'||p_key,'opening',null,p_gotyme,p_reference,p_at,p_actor,jsonb_build_object('allocate',p_allocate,'allocation_limit',p_allocation_limit));
 s:=public.money_treasury_summary();
 if p_allocate is true then
  if p_allocation_limit is null or p_allocation_limit<10000 then raise exception 'Allocation limit must be at least PHP100'; end if;
  allocation:=least((s->>'unallocated')::bigint,100000000,p_allocation_limit);
  if allocation>=10000 then perform public.money_treasury_fund(p_actor,allocation,p_key,'treasury-opening:'||p_key,true); end if;
 end if;
 perform public.money_treasury_check_shortfall();
 return public.money_treasury_summary()||jsonb_build_object('allocated',case when allocation>=10000 then allocation else 0 end);
end $$;

commit;
