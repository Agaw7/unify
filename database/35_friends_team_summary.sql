begin;

create or replace function public.money_live_team(p_user uuid) returns jsonb language sql stable security definer set search_path='' as $$
 with recursive tree as (
 select t.id,t.created_at,1 as level,array[p_user,t.id] as path from public.team_members t where t.invited_by=p_user and t.id<>p_user
 union all select t.id,t.created_at,p.level+1,p.path||t.id from public.team_members t join tree p on t.invited_by=p.id where p.level<3 and not t.id=any(p.path)
 ), visible_team as (
   select tree.*, u.phone
   from tree join auth.users u on u.id=tree.id and u.deleted_at is null
 ) select jsonb_build_object('active_friends',(
   select count(*) from visible_team friend
   where friend.level=1 and exists (
     select 1 from public.money_transactions deposit
     where deposit.user_id=friend.id and deposit.kind='deposit'
       and deposit.status='completed' and deposit.amount>0
   )
 ), 'total_commission',coalesce((select sum(amount) from public.money_referral_commissions where beneficiary_id=p_user and status='paid'),0),
 'pending_commission',coalesce((select sum(amount) from public.money_referral_commissions where beneficiary_id=p_user and status='pending'),0),
 'levels',(select jsonb_agg(jsonb_build_object('level',l,'rate',case l when 1 then 18 when 2 then 3 else 1 end,'count',(select count(*) from visible_team where level=l),
 'commission',coalesce((select sum(amount) from public.money_referral_commissions where beneficiary_id=p_user and level=l and status='paid'),0),
 'members',coalesce((select jsonb_agg(to_jsonb(m)) from (
 select page.id,page.created_at,right(regexp_replace(coalesce(page.phone,''),'[^0-9]','','g'),4) phone_last4,
 coalesce((select sum(t.amount) from public.money_transactions t where t.user_id=page.id and t.kind='deposit' and t.status='completed'),0) deposits,
 coalesce((select sum(c.amount) from public.money_referral_commissions c where c.beneficiary_id=p_user and c.depositor_id=page.id and c.status='paid'),0) commission
 from (select * from visible_team where level=l order by created_at desc,id limit 100) page
 ) m),'[]'::jsonb)) order by l) from generate_series(1,3) l))
$$;
revoke all on function public.money_live_team(uuid) from public,anon,authenticated;
grant execute on function public.money_live_team(uuid) to service_role;

notify pgrst,'reload schema';
commit;
