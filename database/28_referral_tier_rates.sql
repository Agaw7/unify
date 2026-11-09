-- New commission accrual rates. Existing commission rows retain their recorded amounts.
begin;
set local lock_timeout='10s';
create or replace function public.money_referrals_process(p_deposit uuid) returns void language plpgsql security definer set search_path='' as $$
declare t public.money_transactions; current_user_id uuid; parent uuid; path uuid[]; lvl integer; amount bigint; c public.money_referral_commissions; tx uuid;
begin
 perform 1 from public.money_business_budget where id=true for update;
 select * into strict t from public.money_transactions where id=p_deposit and kind='deposit';
 if t.status<>'completed' or not exists(select 1 from public.money_holds where transaction_id=t.id and released) then return; end if;
 if not public.money_deposit_ready(t.user_id) then return; end if;
 if exists(select 1 from public.money_adjustments where transaction_id=t.id and status not in ('failed','won')) then
 update public.money_referral_commissions set status='cancelled' where deposit_id=t.id and status='pending';return;
 end if;
 current_user_id:=t.user_id;path:=array[t.user_id];
 for lvl in 1..3 loop
 select invited_by into parent from public.team_members where id=current_user_id;
 exit when parent is null or parent=any(path);path:=array_append(path,parent);
 amount:=floor(t.amount::numeric*(case lvl when 1 then 1800 when 2 then 300 else 100 end)/10000)::bigint;
 if amount>0 then insert into public.money_referral_commissions(deposit_id,beneficiary_id,depositor_id,level,amount) values(t.id,parent,t.user_id,lvl,amount) on conflict do nothing;end if;
 current_user_id:=parent;
 end loop;
 for c in select * from public.money_referral_commissions where deposit_id=t.id and status='pending' order by level for update loop
 if not public.money_deposit_ready(c.beneficiary_id) then continue; end if;
 update public.money_business_budget set available=available-c.amount where id=true and available>=c.amount;
 if not found then continue; end if;
 insert into public.money_transactions(user_id,kind,amount,method,status,idempotency_key) values(c.beneficiary_id,'referral_commission',c.amount,'internal','completed',c.id) returning id into tx;
 insert into public.money_wallets(user_id,available) values(c.beneficiary_id,c.amount) on conflict(user_id) do update set available=public.money_wallets.available+excluded.available;
 insert into public.money_ledger(user_id,transaction_id,action,available_delta,reserved_delta) values(c.beneficiary_id,tx,'referral_commission',c.amount,0);
 update public.money_referral_commissions set status='paid',transaction_id=tx where id=c.id;
 insert into public.money_business_ledger(action,subject_id,available_delta) values('referral_commission',c.id,-c.amount);
 end loop;
 insert into public.money_audit(subject_id,action) select t.id,'referral_batch_processed' where not exists(select 1 from public.money_audit where subject_id=t.id and action='referral_batch_processed');
end $$;
create or replace function public.money_live_team(p_user uuid) returns jsonb language sql stable security definer set search_path='' as $$
 with recursive tree as (
 select t.id,t.created_at,1 as level,array[p_user,t.id] as path from public.team_members t where t.invited_by=p_user and t.id<>p_user
 union all select t.id,t.created_at,p.level+1,p.path||t.id from public.team_members t join tree p on t.invited_by=p.id where p.level<3 and not t.id=any(p.path)
 ) select jsonb_build_object('total_commission',coalesce((select sum(amount) from public.money_referral_commissions where beneficiary_id=p_user and status='paid'),0),
 'pending_commission',coalesce((select sum(amount) from public.money_referral_commissions where beneficiary_id=p_user and status='pending'),0),
 'levels',(select jsonb_agg(jsonb_build_object('level',l,'rate',case l when 1 then 18 when 2 then 3 else 1 end,'count',(select count(*) from tree where level=l),
 'commission',coalesce((select sum(amount) from public.money_referral_commissions where beneficiary_id=p_user and level=l and status='paid'),0),
 'members',coalesce((select jsonb_agg(to_jsonb(m)) from (
 select page.id,page.created_at,right(regexp_replace(coalesce(u.phone,''),'[^0-9]','','g'),4) phone_last4,
 coalesce((select sum(t.amount) from public.money_transactions t where t.user_id=page.id and t.kind='deposit' and t.status='completed'),0) deposits,
 coalesce((select sum(c.amount) from public.money_referral_commissions c where c.beneficiary_id=p_user and c.depositor_id=page.id and c.status='paid'),0) commission
 from (select * from tree where level=l order by created_at desc,id limit 100) page left join auth.users u on u.id=page.id
 ) m),'[]'::jsonb)) order by l) from generate_series(1,3) l))
$$;
revoke all on function public.money_live_team(uuid) from public,anon,authenticated;
grant execute on function public.money_live_team(uuid) to service_role;

notify pgrst,'reload schema';
commit;
