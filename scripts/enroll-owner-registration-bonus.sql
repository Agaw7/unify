-- One-time owner-authorized enrollment. No bonus is credited by this script.
begin;
do $$ begin
 if not exists(select 1 from auth.users u join public.profiles p on p.id=u.id
 where u.id='fc955312-fb86-48e6-b4d4-4163c947c2bc' and u.phone in ('639157471830','09157471830') and p.role='admin') then
 raise exception 'Requested owner account does not match';
 end if;
end $$;
insert into public.money_registration_bonus_queue(user_id)
select u.id from auth.users u where u.id='fc955312-fb86-48e6-b4d4-4163c947c2bc'
and not exists(select 1 from public.money_registration_bonuses b where b.user_id=u.id)
on conflict(user_id) do nothing;
commit;
