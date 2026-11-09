begin;
set local lock_timeout = '10s';

create function public.money_treasury_reward_deposit(
  p_actor uuid,
  p_account text,
  p_amount bigint,
  p_key uuid,
  p_reference text,
  p_at timestamptz,
  p_confirm boolean
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_account public.money_treasury_accounts;
  v_entry public.money_treasury_entries;
  v_id uuid;
  v_summary jsonb;
begin
  if p_actor is null or not exists(select 1 from public.profiles where id=p_actor and role='admin') then
    raise exception 'Administrator required';
  end if;
  if p_confirm is distinct from true or p_account is null or p_account not in ('palawan','gotyme')
      or p_amount is null or p_amount<10000 or p_amount>100000000
      or p_key is null or length(trim(coalesce(p_reference,''))) not between 5 and 100
      or p_at is null or p_at>clock_timestamp()+interval '1 minute' then
    raise exception 'Confirm the verified business deposit details';
  end if;

  perform 1 from public.money_business_budget where id=true for update;
  perform 1 from public.money_treasury_accounts order by id for update;
  select * into strict v_account from public.money_treasury_accounts where id=p_account;
  if v_account.reconciled_at is null then
    raise exception 'Confirm the account opening balance before recording a deposit';
  end if;
  if p_at<v_account.reconciled_at then
    raise exception 'Deposit time must be after the latest account reconciliation';
  end if;

  select * into v_entry from public.money_treasury_entries
    where account_id=p_account and entry_key='reward-deposit:'||p_key;
  if found then
    if v_entry.delta<>p_amount or v_entry.reference<>p_reference or v_entry.occurred_at<>p_at
        or v_entry.kind<>'deposit' then
      raise exception 'Reward funding request conflict';
    end if;
    v_id:=public.money_treasury_fund(p_actor,p_amount,p_key,p_reference,true);
    return public.money_treasury_summary()||jsonb_build_object('fundingId',v_id,'alreadyRecorded',true);
  end if;

  v_summary:=public.money_treasury_summary();
  if (v_summary->>'ready')::boolean is distinct from true then
    raise exception 'Opening balances must be confirmed first';
  end if;
  if (v_summary->>'shortfall')::bigint>0 then
    raise exception 'Reconcile cash shortfalls before funding the rewards budget';
  end if;

  perform public.money_treasury_post(
    p_account,'reward-deposit:'||p_key,'deposit',null,p_amount,p_reference,p_at,p_actor,
    jsonb_build_object('purpose','verified_business_rewards_funding')
  );
  v_id:=public.money_treasury_fund(p_actor,p_amount,p_key,p_reference,true);
  return public.money_treasury_summary()||jsonb_build_object('fundingId',v_id,'alreadyRecorded',false);
end $$;

revoke all on function public.money_treasury_reward_deposit(uuid,text,bigint,uuid,text,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.money_treasury_reward_deposit(uuid,text,bigint,uuid,text,timestamptz,boolean) to service_role;
notify pgrst,'reload schema';
commit;
