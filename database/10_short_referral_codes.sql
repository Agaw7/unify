begin;
-- Keep the original invite_code for old links; use a unique 6-character code
-- for new links. Existing relationships and commissions are unchanged.
alter table public.profiles add column if not exists short_invite_code text;
create unique index if not exists profiles_short_invite_code_unique on public.profiles(short_invite_code);
create or replace function public.assign_short_referral_code()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_code text;
begin
 if tg_op='UPDATE' and old.short_invite_code is not null then
  if new.short_invite_code is distinct from old.short_invite_code then raise exception 'Referral code cannot be changed'; end if;
  return new;
 end if;
 perform pg_catalog.pg_advisory_xact_lock(814728306);
 loop
  v_code:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  exit when not exists(select 1 from public.profiles where short_invite_code=v_code or invite_code=v_code);
 end loop;
 new.short_invite_code:=v_code;
 return new;
end; $$;
revoke all on function public.assign_short_referral_code() from public,anon,authenticated;
drop trigger if exists assign_short_referral_code on public.profiles;
create trigger assign_short_referral_code before insert or update of short_invite_code on public.profiles
 for each row execute function public.assign_short_referral_code();
update public.profiles set short_invite_code=null where short_invite_code is null;

create or replace function public.resolve_invite_code(p_code text)
returns text language sql stable security definer set search_path='' as $$
 select short_invite_code from public.profiles
 where invite_code=upper(trim(p_code)) or short_invite_code=upper(trim(p_code)) limit 1;
$$;
revoke all on function public.resolve_invite_code(text) from public;
grant execute on function public.resolve_invite_code(text) to anon,authenticated;

create or replace function public.capture_signup_referral()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_code text; v_inviter uuid;
begin
 select upper(trim(raw_user_meta_data->>'referral_code')) into v_code from auth.users where id=new.id;
 if v_code is null or v_code='' then return new; end if;
 if v_code !~ '^[A-Z0-9]{6,64}$' then raise exception 'Invalid invitation code'; end if;
 select id into v_inviter from public.profiles
 where (invite_code=v_code or short_invite_code=v_code) and id<>new.id;
 if v_inviter is null then raise exception 'Invalid invitation code'; end if;
 insert into public.team_members(id,invited_by,full_name,created_at)
 values(new.id,v_inviter,null,new.created_at) on conflict(id) do nothing;
 return new;
end; $$;
revoke all on function public.capture_signup_referral() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
