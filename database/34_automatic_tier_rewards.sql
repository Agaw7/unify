begin;

create function public.money_credit_due_tier_rewards(p_user uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  tier record;
  credited_count integer := 0;
  failed_count integer := 0;
begin
  if p_user is not null and not exists (
    select 1 from public.money_investments
    where user_id=p_user and claimed_days < duration_days
      and created_at + (claimed_days + 1) * interval '24 hours' <= now()
      and public.money_deposit_ready(user_id)
  ) then
    return jsonb_build_object('processed',0,'failed',0);
  end if;
  -- Take locks in the same order as the existing reward credit function.
  perform 1 from public.money_business_budget where id=true for update;
  for tier in
    select id,user_id from public.money_investments
    where claimed_days < duration_days
      and (p_user is null or user_id=p_user)
      and created_at + (claimed_days + 1) * interval '24 hours' <= now()
      and public.money_deposit_ready(user_id)
    order by created_at + (claimed_days + 1) * interval '24 hours', id
    limit 500
  loop
    begin
      perform public.money_investment_claim(tier.user_id,tier.id);
      credited_count := credited_count + 1;
    exception when others then
      failed_count := failed_count + 1;
      raise log 'Automatic tier reward failed for % (SQLSTATE %)',tier.id,sqlstate;
    end;
  end loop;
  return jsonb_build_object('processed',credited_count,'failed',failed_count);
end;
$$;

revoke all on function public.money_credit_due_tier_rewards(uuid) from public,anon,authenticated;
grant execute on function public.money_credit_due_tier_rewards(uuid) to service_role;
notify pgrst,'reload schema';
commit;
