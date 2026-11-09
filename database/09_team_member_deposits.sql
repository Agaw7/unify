begin;
-- Extend the existing caller-scoped summary; return only the last four phone
-- digits and verified test totals, never a complete phone or live PHP records.
create or replace function public.my_sandbox_team()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_result jsonb;
begin
 if v_user is null then raise exception 'Authentication required'; end if;
 with recursive tree as (
  select t.id,t.created_at,1 as level,array[v_user,t.id] as path
  from public.team_members t where t.invited_by=v_user and t.id<>v_user
  union all
  select t.id,t.created_at,p.level+1,p.path||t.id from public.team_members t join tree p on t.invited_by=p.id
  where p.level<3 and not t.id=any(p.path)
 )
 select jsonb_build_object('total_commission',coalesce((select sum(amount_centavos)::numeric/100 from public.sandbox_referral_commissions where beneficiary_id=v_user),0),
  'levels',(select jsonb_agg(jsonb_build_object('level',l,'count',(select count(*) from tree where level=l),
   'commission',coalesce((select sum(amount_centavos)::numeric/100 from public.sandbox_referral_commissions where beneficiary_id=v_user and level=l),0),
   'members',coalesce((select jsonb_agg(to_jsonb(m)) from (
    select page.id,null::text as full_name,page.created_at,
     case when length(regexp_replace(coalesce(u.phone,''),'[^0-9]','','g'))>=4
       then right(regexp_replace(u.phone,'[^0-9]','','g'),4) else null end as phone_last4,
     coalesce((select sum(p.amount) from public.payment_transactions p
       where p.user_id=page.id and p.transaction_type='deposit' and p.status='completed'
       and p.provider='paymongo' and p.currency='PHP'
       and exists(select 1 from public.wallet_ledger w where w.transaction_id=p.id
         and w.user_id=p.user_id and w.entry_type='deposit_credit' and w.amount=p.amount)),0) as verified_deposits
    from (select id,created_at from tree where level=l order by created_at desc,id limit 100) page
    left join auth.users u on u.id=page.id
    order by page.created_at desc,page.id
   ) m),'[]'::jsonb)) order by l) from generate_series(1,3) l)) into v_result;
 return v_result;
end; $$;
revoke all on function public.my_sandbox_team() from public,anon;
grant execute on function public.my_sandbox_team() to authenticated;
notify pgrst,'reload schema';
commit;
