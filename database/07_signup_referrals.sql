begin;
-- Attribute referrals once, during profile creation. Metadata changes on an
-- existing account never reassign its inviter or generate rewards.
create or replace function public.capture_signup_referral()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_code text; v_inviter uuid;
begin
 select upper(trim(raw_user_meta_data->>'referral_code')) into v_code
 from auth.users where id=new.id;
 if v_code is null or v_code='' then return new; end if;
 if v_code !~ '^[A-Z0-9]{6,64}$' then raise exception 'Invalid invitation code'; end if;
 select id into v_inviter from public.profiles where invite_code=v_code and id<>new.id;
 if v_inviter is null then raise exception 'Invalid invitation code'; end if;
 insert into public.team_members(id,invited_by,full_name,created_at)
 values(new.id,v_inviter,null,new.created_at) on conflict(id) do nothing;
 return new;
end; $$;
revoke all on function public.capture_signup_referral() from public,anon,authenticated;
drop trigger if exists capture_signup_referral on public.profiles;
create trigger capture_signup_referral after insert on public.profiles
 for each row execute function public.capture_signup_referral();
notify pgrst,'reload schema';
commit;
