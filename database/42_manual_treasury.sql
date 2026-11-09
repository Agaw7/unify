-- Additive only. No opening cash, allocation, member credit or transfer is posted by this migration.
begin;
create table public.money_treasury_accounts(
 id text primary key check(id in ('palawan','gotyme')),
 balance bigint not null default 0 check(balance>=0),
 reconciled_at timestamptz, confirmed_by uuid references auth.users(id), reference text,
 updated_at timestamptz not null default now()
);
insert into public.money_treasury_accounts(id) values('palawan'),('gotyme');
create table public.money_treasury_entries(
 id uuid primary key default gen_random_uuid(),account_id text not null references public.money_treasury_accounts(id),
 entry_key text not null,kind text not null,transaction_id uuid references public.money_transactions(id),
 delta bigint not null,balance_after bigint not null check(balance_after>=0),
 reference text not null,occurred_at timestamptz not null,actor_id uuid not null references auth.users(id),
 details jsonb not null default '{}',created_at timestamptz not null default now(),unique(account_id,entry_key)
);
create unique index money_treasury_external_reference_once on public.money_treasury_entries(account_id,reference)
 where kind in ('deposit','payout','transfer_in','transfer_out');
alter table public.money_treasury_accounts enable row level security;
alter table public.money_treasury_entries enable row level security;
revoke all on public.money_treasury_accounts,public.money_treasury_entries from public,anon,authenticated,service_role;
grant select on public.money_treasury_accounts,public.money_treasury_entries to service_role;

create function public.money_treasury_summary() returns jsonb language sql stable security definer set search_path='' as $$
 with a as(select coalesce(sum(balance),0) cash,bool_and(reconciled_at is not null) ready from public.money_treasury_accounts),
 w as(select coalesce(sum(available::numeric+deposit_available+reserved+held),0) liabilities from public.money_wallets),
 b as(select available,reserved,sales from public.money_business_budget where id=true)
 select jsonb_build_object('ready',a.ready,'cash',a.cash,'liabilities',w.liabilities,
 'unallocated',greatest(0,a.cash-w.liabilities-b.available-b.reserved-b.sales),
 'rewardAvailable',b.available,'rewardReserved',b.reserved,'sales',b.sales,
 'shortfall',greatest(0,w.liabilities+b.available+b.reserved-a.cash),
 'accounts',(select jsonb_agg(jsonb_build_object('id',id,'balance',balance,'reconciled_at',reconciled_at,'reference',reference) order by id) from public.money_treasury_accounts)) from a,w,b;
$$;

create function public.money_treasury_post(p_account text,p_key text,p_kind text,p_tx uuid,p_delta bigint,p_reference text,p_at timestamptz,p_actor uuid,p_details jsonb default '{}')
returns void language plpgsql security definer set search_path='' as $$
declare a public.money_treasury_accounts; e public.money_treasury_entries;
begin
 if p_actor is null or not exists(select 1 from public.profiles where id=p_actor and role='admin') then raise exception 'Administrator required'; end if;
 if p_key is null or p_delta is null or p_at is null or p_at>clock_timestamp()+interval '1 minute' or length(trim(coalesce(p_reference,''))) not between 5 and 120 then raise exception 'Invalid cash entry'; end if;
 select * into strict a from public.money_treasury_accounts where id=p_account for update;
 if a.reconciled_at is null then raise exception 'Opening balances must be confirmed first'; end if;
 select * into e from public.money_treasury_entries where account_id=p_account and entry_key=p_key;
 if found then
  if e.delta<>p_delta or e.reference<>p_reference or e.transaction_id is distinct from p_tx or e.occurred_at<>p_at or e.kind<>p_kind then raise exception 'Cash entry conflict'; end if;
  return;
 end if;
 if a.balance+p_delta<0 then raise exception 'Cash ledger is insufficient; reconcile the actual source account'; end if;
 update public.money_treasury_accounts set balance=balance+p_delta,updated_at=now() where id=p_account;
 insert into public.money_treasury_entries(account_id,entry_key,kind,transaction_id,delta,balance_after,reference,occurred_at,actor_id,details)
 values(p_account,p_key,p_kind,p_tx,p_delta,a.balance+p_delta,p_reference,p_at,p_actor,p_details);
 insert into public.money_audit(actor_id,subject_id,action,details) values(p_actor,p_tx,'treasury_cash_entry',jsonb_build_object('account',p_account,'delta',p_delta,'kind',p_kind,'reference',p_reference));
end $$;

create function public.money_treasury_check_shortfall() returns void language plpgsql security definer set search_path='' as $$
declare s jsonb;
begin
 s:=public.money_treasury_summary();
 if (s->>'ready')::boolean then
  insert into public.money_alerts(key,severity,message,resolved,updated_at) values('manual-treasury-shortfall','critical','Reconciled cash is below existing member and funded reward obligations',(s->>'shortfall')::numeric=0,now())
  on conflict(key) do update set resolved=excluded.resolved,updated_at=now();
 end if;
end $$;

create function public.money_treasury_fund(p_actor uuid,p_amount bigint,p_key uuid,p_reference text,p_confirm boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare s jsonb;
begin
 if p_confirm is distinct from true then raise exception 'Business funding confirmation required'; end if;
 perform 1 from public.money_business_budget where id=true for update;
 perform 1 from public.money_treasury_accounts order by id for update;
 s:=public.money_treasury_summary();
 if not (s->>'ready')::boolean then raise exception 'Opening balances must be confirmed first'; end if;
 begin
  return public.money_business_fund(p_actor,p_amount,p_key,p_reference,'manual:palawan+gotyme',(s->>'cash')::bigint);
 exception when raise_exception then
  if sqlerrm='Insufficient unallocated verified PayMongo funds' then raise exception 'Insufficient unallocated recorded cash'; else raise; end if;
 end;
end $$;

create function public.money_treasury_open(p_actor uuid,p_palawan bigint,p_gotyme bigint,p_key uuid,p_reference text,p_at timestamptz,p_allocate boolean,p_confirm boolean,p_allocation_limit bigint default 0)
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
 update public.money_treasury_accounts set reconciled_at=p_at,confirmed_by=p_actor,reference=p_reference,updated_at=now();
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

create function public.money_treasury_approve_deposit(p_id uuid,p_actor uuid,p_reference text,p_received_at timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare t public.money_transactions; a public.money_treasury_accounts; prior public.money_treasury_entries; delta bigint;
begin
 perform 1 from public.money_business_budget where id=true for update;
 select user_id into strict t.user_id from public.money_transactions where id=p_id;
 perform pg_advisory_xact_lock(hashtextextended(t.user_id::text,0));
 select * into strict t from public.money_transactions where id=p_id for update;
 select * into strict a from public.money_treasury_accounts where id='palawan' for update;
 if a.reconciled_at is not null then
  if p_received_at is null or p_received_at>clock_timestamp()+interval '1 minute' or p_received_at<t.created_at-interval '90 days' then raise exception 'Enter the actual received payment time from PalawanPay history'; end if;
  delta:=case when p_received_at<=a.reconciled_at then 0 else t.amount end;
  select * into prior from public.money_treasury_entries where account_id='palawan' and entry_key='deposit:'||p_id;
  if found then delta:=prior.delta; elsif t.status='completed' then delta:=0; end if;
  perform public.money_treasury_post('palawan','deposit:'||p_id,'deposit',p_id,delta,'palawan:'||p_reference,p_received_at,p_actor,jsonb_build_object('amount',t.amount,'included_in_snapshot',delta=0));
 end if;
 perform public.money_approve_palawan_deposit(p_id,p_actor,p_reference);
end $$;

create function public.money_treasury_complete_payout(p_id uuid,p_actor uuid,p_reference text,p_status text,p_confirm boolean,p_sent_at timestamptz,p_sending_fee bigint default 0)
returns void language plpgsql security definer set search_path='' as $$
declare t public.money_transactions; a public.money_treasury_accounts; prior public.money_treasury_entries; delta bigint;
begin
 perform 1 from public.money_business_budget where id=true for update;
 select * into strict t from public.money_transactions where id=p_id for update;
 select * into strict a from public.money_treasury_accounts where id='gotyme' for update;
 if p_sending_fee is null or p_sending_fee<0 or p_sending_fee>100000 or (p_status='failed' and p_sending_fee<>0) then raise exception 'Invalid sending fee'; end if;
 if p_status='succeeded' and a.reconciled_at is not null then
  if p_sent_at is null or p_sent_at>clock_timestamp()+interval '1 minute' or p_sent_at<t.created_at then raise exception 'Enter the actual GoTyme transfer time'; end if;
  delta:=case when p_sent_at<=a.reconciled_at then 0 else -(t.amount-t.withdrawal_fee+p_sending_fee) end;
  select * into prior from public.money_treasury_entries where account_id='gotyme' and entry_key='payout:'||p_id;
  if found then
   if coalesce((prior.details->>'sending_fee')::bigint,0)<>p_sending_fee then raise exception 'Sending fee conflict'; end if;
   delta:=prior.delta;
  elsif t.status='completed' then delta:=0; end if;
  perform public.money_treasury_post('gotyme','payout:'||p_id,'payout',p_id,delta,'gotyme:'||p_reference,p_sent_at,p_actor,jsonb_build_object('net_sent',t.amount-t.withdrawal_fee,'sending_fee',p_sending_fee,'included_in_snapshot',delta=0));
 end if;
 perform public.money_record_manual_gotyme(p_id,p_actor,p_reference,p_status,p_confirm);
 perform public.money_treasury_check_shortfall();
end $$;

create function public.money_treasury_reconcile(p_actor uuid,p_account text,p_balance bigint,p_at timestamptz,p_reference text,p_key uuid,p_confirm boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.money_treasury_accounts; prior public.money_treasury_entries; s jsonb;
begin
 if p_actor is null or not exists(select 1 from public.profiles where id=p_actor and role='admin') or p_confirm is distinct from true then raise exception 'Administrator confirmation required'; end if;
 if p_balance is null or p_balance<0 or p_balance>100000000000 or p_key is null or p_at is null or p_at>clock_timestamp()+interval '1 minute' then raise exception 'Invalid reconciliation'; end if;
 perform 1 from public.money_business_budget where id=true for update;
 select * into strict a from public.money_treasury_accounts where id=p_account for update;
 select * into prior from public.money_treasury_entries where account_id=p_account and entry_key='reconcile:'||p_key;
 if found then
  if prior.balance_after<>p_balance or prior.reference<>p_reference or prior.occurred_at<>p_at then raise exception 'Reconciliation conflict'; end if;
  return public.money_treasury_summary();
 end if;
 if a.reconciled_at is null or p_at<a.reconciled_at or exists(select 1 from public.money_treasury_entries where account_id=p_account and occurred_at>p_at) then raise exception 'Use a current statement after the latest recorded movement'; end if;
 perform public.money_treasury_post(p_account,'reconcile:'||p_key,'reconcile',null,p_balance-a.balance,p_reference,p_at,p_actor);
 update public.money_treasury_accounts set reconciled_at=p_at,reference=p_reference,confirmed_by=p_actor where id=p_account;
 s:=public.money_treasury_summary();
 perform public.money_treasury_check_shortfall();
 return s;
end $$;

create function public.money_treasury_transfer(p_actor uuid,p_from text,p_to text,p_amount bigint,p_fee bigint,p_reference text,p_at timestamptz,p_key uuid,p_confirm boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_confirm is distinct from true or p_from=p_to or p_amount is null or p_amount<=0 or p_amount>100000000000 or p_fee is null or p_fee<0 or p_fee>100000 or p_key is null then raise exception 'Confirm the completed internal transfer'; end if;
 perform 1 from public.money_business_budget where id=true for update;
 perform 1 from public.money_treasury_accounts order by id for update;
 if exists(select 1 from public.money_treasury_accounts where reconciled_at is null or reconciled_at>=p_at) then raise exception 'Transfer must be after both reconciliation snapshots'; end if;
 perform public.money_treasury_post(p_from,'transfer-out:'||p_key,'transfer_out',null,-(p_amount+p_fee),p_from||':'||p_reference,p_at,p_actor,jsonb_build_object('to',p_to,'fee',p_fee));
 perform public.money_treasury_post(p_to,'transfer-in:'||p_key,'transfer_in',null,p_amount,p_to||':'||p_reference,p_at,p_actor,jsonb_build_object('from',p_from));
 perform public.money_treasury_check_shortfall();
 return public.money_treasury_summary();
end $$;

revoke all on function public.money_treasury_summary(),public.money_treasury_post(text,text,text,uuid,bigint,text,timestamptz,uuid,jsonb),public.money_treasury_fund(uuid,bigint,uuid,text,boolean),public.money_treasury_open(uuid,bigint,bigint,uuid,text,timestamptz,boolean,boolean,bigint),public.money_treasury_approve_deposit(uuid,uuid,text,timestamptz),public.money_treasury_complete_payout(uuid,uuid,text,text,boolean,timestamptz,bigint),public.money_treasury_reconcile(uuid,text,bigint,timestamptz,text,uuid,boolean),public.money_treasury_transfer(uuid,text,text,bigint,bigint,text,timestamptz,uuid,boolean) from public,anon,authenticated;
grant execute on function public.money_treasury_summary(),public.money_treasury_fund(uuid,bigint,uuid,text,boolean),public.money_treasury_open(uuid,bigint,bigint,uuid,text,timestamptz,boolean,boolean,bigint),public.money_treasury_approve_deposit(uuid,uuid,text,timestamptz),public.money_treasury_complete_payout(uuid,uuid,text,text,boolean,timestamptz,bigint),public.money_treasury_reconcile(uuid,text,bigint,timestamptz,text,uuid,boolean),public.money_treasury_transfer(uuid,text,text,bigint,bigint,text,timestamptz,uuid,boolean) to service_role;
revoke all on function public.money_treasury_post(text,text,text,uuid,bigint,text,timestamptz,uuid,jsonb),public.money_treasury_check_shortfall() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
