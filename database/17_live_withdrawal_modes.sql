-- Apply after 16. Existing requests retain admin approval. This migration sends no transfers.
begin;
create table if not exists public.money_settings (
 id boolean primary key default true check(id),
 withdrawal_mode text not null default 'admin_approval' check(withdrawal_mode in ('admin_approval','automatic')),
 updated_by uuid references auth.users(id),updated_at timestamptz not null default now()
);
insert into public.money_settings(id) values(true) on conflict do nothing;
alter table public.money_settings enable row level security;
revoke all on public.money_settings from public,anon,authenticated;
grant select,update on public.money_settings to service_role;
alter table public.money_transactions add column if not exists withdrawal_mode text not null default 'admin_approval' check(withdrawal_mode in ('admin_approval','automatic'));
create or replace function public.money_snapshot_withdrawal_mode() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.kind='withdrawal' then
  select withdrawal_mode into new.withdrawal_mode from public.money_settings where id=true for share;
 end if;
 return new;
end $$;
drop trigger if exists money_withdrawal_mode on public.money_transactions;
create trigger money_withdrawal_mode before insert on public.money_transactions for each row execute function public.money_snapshot_withdrawal_mode();
create or replace function public.money_set_withdrawal_mode(p_actor uuid,p_mode text,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare previous text;
begin
 if not exists(select 1 from public.profiles where id=p_actor and role='admin') then raise exception 'Administrator required'; end if;
 if p_mode is null or p_mode not in ('automatic','admin_approval') or length(trim(coalesce(p_reason,'')))<5 or length(p_reason)>500 then raise exception 'Mode and reason required'; end if;
 select withdrawal_mode into previous from public.money_settings where id=true for update;
 update public.money_settings set withdrawal_mode=p_mode,updated_by=p_actor,updated_at=now() where id=true;
 insert into public.money_audit(actor_id,action,details) values(p_actor,'withdrawal_mode_changed',jsonb_build_object('previous',previous,'mode',p_mode,'reason',p_reason));
end $$;
create or replace function public.money_claim_automatic_payout(p_id uuid) returns public.money_transactions language plpgsql security definer set search_path='' as $$
declare t public.money_transactions; customer uuid;
begin
 select user_id into strict customer from public.money_transactions where id=p_id;
 perform pg_advisory_xact_lock(hashtextextended(customer::text,0));
 select * into strict t from public.money_transactions where id=p_id for update;
 if t.kind<>'withdrawal' or t.withdrawal_mode<>'automatic' or t.status<>'reserved' or t.provider_reference is not null then raise exception 'Automatic payout already claimed or ineligible'; end if;
 if not exists(select 1 from public.money_customers where user_id=t.user_id and verified and not blocked)
 or not exists(select 1 from public.money_destinations where id=t.destination_id and verified)
 or not public.money_customer_ready(t.user_id,t.destination_id) then raise exception 'Customer or destination restricted'; end if;
 update public.money_transactions set status='processing',updated_at=now() where id=t.id returning * into t;
 insert into public.money_audit(subject_id,action,details) values(t.id,'claim_automatic_payout',jsonb_build_object('mode','automatic'));
 return t;
end $$;
revoke all on function public.money_snapshot_withdrawal_mode(),public.money_set_withdrawal_mode(uuid,text,text),public.money_claim_automatic_payout(uuid) from public,anon,authenticated;
grant execute on function public.money_set_withdrawal_mode(uuid,text,text),public.money_claim_automatic_payout(uuid) to service_role;
notify pgrst,'reload schema';
commit;
