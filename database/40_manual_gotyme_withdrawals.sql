begin;
set local lock_timeout='10s';
alter table public.money_destinations drop constraint money_destinations_method_check;
alter table public.money_destinations add constraint money_destinations_method_check check(method in ('gcash','maya','gotyme'));
alter table public.money_destinations drop constraint money_destinations_account_number_check;
alter table public.money_destinations add constraint money_destinations_account_number_check check(
  (method in ('gcash','maya') and account_number ~ '^09[0-9]{9}$')
  or (method='gotyme' and account_number ~ '^[0-9]{6,20}$')
);
alter table public.money_transactions drop constraint money_transactions_method_check;
alter table public.money_transactions add constraint money_transactions_method_check check(
  (kind='deposit' and method in ('gcash','maya','qrph'))
  or (kind='withdrawal' and method in ('gcash','maya','gotyme'))
  or (kind not in ('deposit','withdrawal') and method='internal')
);
do $$
declare definition text:=pg_get_functiondef('public.money_request(uuid,text,bigint,text,uuid,uuid)'::regprocedure);
begin
  if strpos(definition, '(p_kind=''withdrawal'' and p_method not in (''gcash'',''maya''))')=0 then
    raise exception 'Unexpected money_request definition; review before migration';
  end if;
  execute replace(definition, '(p_kind=''withdrawal'' and p_method not in (''gcash'',''maya''))',
    '(p_kind=''withdrawal'' and p_method not in (''gcash'',''maya'',''gotyme''))');
end $$;

create function public.money_record_manual_gotyme(p_id uuid,p_actor uuid,p_reference text,p_status text,p_confirm boolean)
returns void language plpgsql security definer set search_path='' as $$
declare t public.money_transactions;
begin
  select * into strict t from public.money_transactions where id=p_id for update;
  if p_actor is null or p_actor=t.user_id or not exists(select 1 from public.profiles where id=p_actor and role='admin') then
    raise exception 'Independent administrator required';
  end if;
  if t.kind<>'withdrawal' or t.method<>'gotyme' or t.withdrawal_mode<>'admin_approval'
    or p_reference is null or p_reference !~ '^[A-Z0-9-]{5,80}$'
    or p_status is null or p_status not in ('succeeded','failed')
    or p_confirm is distinct from true then raise exception 'Invalid manual GoTyme confirmation'; end if;
  if t.provider_reference is not null and t.provider_reference is distinct from 'manual-gotyme:'||p_reference then
    raise exception 'Withdrawal already linked to a different transfer';
  end if;
  if t.status in ('completed','failed') then
    perform public.money_settle(p_id,'manual-gotyme:'||p_reference,p_status);
    return;
  end if;
  if t.status<>'processing' then raise exception 'Withdrawal must be claimed before recording transfer result'; end if;
  update public.money_transactions set provider_reference='manual-gotyme:'||p_reference where id=p_id;
  perform public.money_settle(p_id,'manual-gotyme:'||p_reference,p_status);
  insert into public.money_audit(actor_id,subject_id,action,details)
    values(p_actor,p_id,'manual_gotyme_result',jsonb_build_object('reference',p_reference,'status',p_status));
end $$;
revoke all on function public.money_record_manual_gotyme(uuid,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.money_record_manual_gotyme(uuid,uuid,text,text,boolean) to service_role;
notify pgrst,'reload schema';
commit;
