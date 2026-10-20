-- Run once in Supabase SQL Editor. DEMO FUNDS ONLY.
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 full_name text,
 role text not null default 'user' check(role in ('user','admin')),
 created_at timestamptz not null default now()
);
create table public.demo_wallets (
 user_id uuid primary key references auth.users(id) on delete cascade,
 balance numeric(14,2) not null default 0 check(balance>=0)
);
create table public.investment_products (
 id bigint generated always as identity primary key,
 name text not null,
 description text,
 minimum_amount numeric(14,2) not null check(minimum_amount>0),
 illustrative_return_pct numeric(7,2) not null default 0 check(illustrative_return_pct>=0 and illustrative_return_pct<=100),
 duration_days integer not null check(duration_days>0),
 is_active boolean not null default true,
 created_at timestamptz not null default now()
);
create table public.demo_investments (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 product_id bigint not null references public.investment_products(id),
 amount numeric(14,2) not null check(amount>0),
 status text not null default 'active' check(status in ('active','completed','cancelled')),
 created_at timestamptz not null default now()
);
create table public.demo_transactions (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 type text not null check(type in ('deposit','withdrawal','investment','return')),
 amount numeric(14,2) not null check(amount>0),
 created_at timestamptz not null default now()
);
create index on public.demo_transactions(user_id,created_at desc);
create index on public.demo_investments(user_id,created_at desc);
-- Create profile and wallet automatically at signup.
create function public.on_demo_user_created() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 insert into public.profiles(id) values(new.id);
 insert into public.demo_wallets(user_id) values(new.id);
 return new;
end; $$;
create trigger create_demo_profile after insert on auth.users
for each row execute function public.on_demo_user_created();
-- RLS: no direct client writes to financial records.
alter table public.profiles enable row level security;
alter table public.demo_wallets enable row level security;
alter table public.investment_products enable row level security;
alter table public.demo_investments enable row level security;
alter table public.demo_transactions enable row level security;
create policy "profile self read" on public.profiles for select to authenticated using(id=(select auth.uid()));
create policy "products read" on public.investment_products for select to authenticated using(is_active=true);
create policy "positions self read" on public.demo_investments for select to authenticated using(user_id=(select auth.uid()));
create policy "transactions self read" on public.demo_transactions for select to authenticated using(user_id=(select auth.uid()));
-- Balance exposed only through own-user RPC.
create function public.my_demo_balance() returns numeric
language sql security definer set search_path = '' as $$
 select balance from public.demo_wallets where user_id=(select auth.uid());
$$;
revoke all on function public.my_demo_balance() from public;
grant execute on function public.my_demo_balance() to authenticated;
-- Atomic simulated operations, serialized by wallet row lock.
create function public.demo_action(p_kind text,p_amount numeric,p_product_id bigint default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_balance numeric; v_min numeric;
begin
 if v_user is null then raise exception 'Authentication required'; end if;
 if p_amount is null or p_amount<=0 or p_amount>100000 or p_amount<>round(p_amount,2) then
  raise exception 'Amount must be between 0.01 and 100000 with at most two decimals';
 end if;
 if p_kind not in ('deposit','withdrawal','investment') or p_kind is null then raise exception 'Invalid demo operation'; end if;
 select balance into v_balance from public.demo_wallets where user_id=v_user for update;
 if not found then raise exception 'Demo wallet missing'; end if;
 if p_kind='investment' then
  select minimum_amount into v_min from public.investment_products where id=p_product_id and is_active=true;
  if not found then raise exception 'Demo product unavailable'; end if;
  if p_amount<v_min then raise exception 'Below product minimum'; end if;
 end if;
 if p_kind in ('withdrawal','investment') and v_balance<p_amount then raise exception 'Insufficient virtual balance'; end if;
 update public.demo_wallets set balance=balance + case when p_kind='deposit' then p_amount else -p_amount end where user_id=v_user;
 if p_kind='investment' then
  insert into public.demo_investments(user_id,product_id,amount) values(v_user,p_product_id,p_amount);
 end if;
 insert into public.demo_transactions(user_id,type,amount) values(v_user,p_kind,p_amount);
end; $$;
revoke all on function public.demo_action(text,numeric,bigint) from public;
grant execute on function public.demo_action(text,numeric,bigint) to authenticated;
-- Admin can create plans only if profile role is admin.
create function public.admin_create_demo_product(p_name text,p_minimum numeric,p_rate numeric,p_days integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and role='admin') then raise exception 'Admin only'; end if;
 if p_name is null or length(trim(p_name)) not between 1 and 80 then raise exception 'Invalid name'; end if;
 if p_minimum is null or p_minimum<=0 or p_minimum>100000 or p_minimum<>round(p_minimum,2) then raise exception 'Invalid minimum'; end if;
 if p_rate is null or p_rate<0 or p_rate>100 then raise exception 'Invalid illustrative rate'; end if;
 if p_days is null or p_days<1 or p_days>3650 then raise exception 'Invalid duration'; end if;
 insert into public.investment_products(name,minimum_amount,illustrative_return_pct,duration_days,description)
 values(trim(p_name),p_minimum,p_rate,p_days,'Fictional educational investment product');
end; $$;
revoke all on function public.admin_create_demo_product(text,numeric,numeric,integer) from public;
grant execute on function public.admin_create_demo_product(text,numeric,numeric,integer) to authenticated;
insert into public.investment_products(name,description,minimum_amount,illustrative_return_pct,duration_days)
values ('Starter Plan','Demo-only illustrative scenario',1000,3,30),
       ('Growth Plan','Demo-only illustrative scenario',5000,5,60),
       ('Premium Plan','Demo-only illustrative scenario',10000,7,90);
-- After registering YOUR OWN account, promote it manually in SQL Editor:
-- update public.profiles set role='admin' where id=(select id from auth.users where email='YOUR_EMAIL');
