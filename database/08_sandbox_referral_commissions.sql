begin;
create table if not exists public.sandbox_referral_commissions (
 id uuid primary key default gen_random_uuid(),
 transaction_id uuid not null references public.payment_transactions(id),
 beneficiary_id uuid not null references public.profiles(id),
 depositor_id uuid not null references public.profiles(id),
 level integer not null check(level between 1 and 3),
 rate_bps integer not null check(rate_bps in (3000,200,100)),
 deposit_centavos bigint not null check(deposit_centavos>0),
 amount_centavos bigint not null check(amount_centavos>0),
 created_at timestamptz not null default now(),
 unique(transaction_id,beneficiary_id),
 unique(transaction_id,level),
 check(beneficiary_id<>depositor_id)
);
create index if not exists sandbox_commissions_beneficiary on public.sandbox_referral_commissions(beneficiary_id,created_at desc);
create index if not exists team_members_inviter on public.team_members(invited_by);
alter table public.sandbox_referral_commissions enable row level security;
revoke all on public.sandbox_referral_commissions from public,anon,authenticated;
grant select on public.sandbox_referral_commissions to authenticated;
drop policy if exists "Own simulated commissions" on public.sandbox_referral_commissions;
create policy "Own simulated commissions" on public.sandbox_referral_commissions for select to authenticated
 using(beneficiary_id=(select auth.uid()));

create or replace function public.credit_sandbox_referral_commissions()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_current uuid:=new.user_id; v_parent uuid; v_path uuid[]:=array[new.user_id];
 v_level integer; v_bps integer; v_base bigint; v_credit bigint; v_inserted uuid;
begin
 if new.status<>'completed' or new.transaction_type<>'deposit' or new.provider<>'paymongo' or new.currency<>'PHP' then return new; end if;
 if old.status='completed' then return new; end if;
 -- This immutable credit is inserted by the provider-verification RPC before
 -- status becomes completed. A client redirect or pending checkout cannot earn.
 if not exists(select 1 from public.wallet_ledger where transaction_id=new.id
   and user_id=new.user_id and entry_type='deposit_credit' and amount=new.amount) then return new; end if;
 if new.amount<=0 or new.amount>50000 or new.amount<>round(new.amount,2) then raise exception 'Invalid simulated commission base'; end if;
 v_base:=(new.amount*100)::bigint;
 for v_level in 1..3 loop
  select invited_by into v_parent from public.team_members where id=v_current;
  exit when v_parent is null or v_parent=any(v_path);
  v_path:=array_append(v_path,v_parent);
  v_bps:=case v_level when 1 then 3000 when 2 then 200 else 100 end;
  v_credit:=floor(v_base::numeric*v_bps/10000)::bigint;
  if v_credit>0 then
   v_inserted:=null;
   insert into public.sandbox_referral_commissions(transaction_id,beneficiary_id,depositor_id,level,rate_bps,deposit_centavos,amount_centavos)
   values(new.id,v_parent,new.user_id,v_level,v_bps,v_base,v_credit)
   on conflict do nothing returning id into v_inserted;
   if v_inserted is not null then
    insert into public.sandbox_wallets(user_id,remaining_balance,currency)
    values(v_parent,v_credit::numeric/100,'PHP')
    on conflict(user_id) do update set remaining_balance=public.sandbox_wallets.remaining_balance+excluded.remaining_balance;
   end if;
  end if;
  v_current:=v_parent;
 end loop;
 return new;
end; $$;
revoke all on function public.credit_sandbox_referral_commissions() from public,anon,authenticated;
drop trigger if exists credit_sandbox_referral_commissions on public.payment_transactions;
create trigger credit_sandbox_referral_commissions after update of status on public.payment_transactions
 for each row execute function public.credit_sandbox_referral_commissions();

-- Read only the caller's own three-level subtree and commission totals.
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
   'members',coalesce((select jsonb_agg(to_jsonb(m)) from (select id,null::text as full_name,created_at from tree where level=l order by created_at desc,id limit 100) m),'[]'::jsonb)) order by l) from generate_series(1,3) l)) into v_result;
 return v_result;
end; $$;
revoke all on function public.my_sandbox_team() from public,anon;
grant execute on function public.my_sandbox_team() to authenticated;
notify pgrst,'reload schema';
commit;
