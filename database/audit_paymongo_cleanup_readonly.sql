-- Read-only preflight for a future Supabase provider cleanup.
-- Returns object names/counts only; does not expose member data or change anything.
begin read only;

select p.oid::regprocedure::text as function_signature,
       p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prokind in ('f', 'p')
  and lower(pg_get_functiondef(p.oid)) like '%paymongo%'
order by function_signature;

select t.event_object_table,
       t.trigger_name,
       t.action_timing,
       t.event_manipulation,
       t.action_statement
from information_schema.triggers t
where t.trigger_schema = 'public'
  and lower(t.action_statement) like '%paymongo%'
order by t.event_object_table, t.trigger_name;

select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and (
    lower(table_name) like '%paymongo%'
    or lower(column_name) like '%paymongo%'
    or lower(column_name) in ('provider', 'provider_reference', 'payment_id')
  )
order by table_name, ordinal_position;

select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and (
    lower(tablename) like '%paymongo%'
    or tablename in (
      'payment_transactions',
      'wallet_ledger',
      'sandbox_wallets',
      'sandbox_referral_commissions',
      'money_transactions',
      'money_business_funding'
    )
  )
order by tablename;

select schemaname, tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and (
    lower(coalesce(qual, '')) like '%paymongo%'
    or lower(coalesce(with_check, '')) like '%paymongo%'
  )
order by tablename, policyname;

select c.conrelid::regclass::text as table_name,
       c.conname as constraint_name,
       c.confrelid::regclass::text as referenced_table,
       pg_get_constraintdef(c.oid) as constraint_definition
from pg_constraint c
where c.contype = 'f'
  and (
    c.conrelid = to_regclass('public.payment_transactions')
    or c.confrelid = to_regclass('public.payment_transactions')
    or c.conrelid = to_regclass('public.sandbox_referral_commissions')
    or c.confrelid = to_regclass('public.sandbox_referral_commissions')
  )
order by table_name, constraint_name;

do $$
declare
  v_count bigint;
  v_status text;
begin
  if to_regclass('public.payment_transactions') is not null
     and exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'payment_transactions'
         and column_name = 'provider'
     ) then
    execute $query$
      select count(*)
      from public.payment_transactions
      where lower(coalesce(provider::text, '')) like '%paymongo%'
    $query$ into v_count;
    raise notice 'payment_transactions with provider PayMongo: %', v_count;

    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'payment_transactions'
        and column_name = 'status'
    ) then
      for v_status, v_count in execute $query$
        select coalesce(status::text, '(null)'), count(*)
        from public.payment_transactions
        where lower(coalesce(provider::text, '')) like '%paymongo%'
        group by status
        order by status
      $query$ loop
        raise notice 'PayMongo transaction status %: %', v_status, v_count;
      end loop;
    end if;
  else
    raise notice 'No public.payment_transactions.provider column found.';
  end if;

  if to_regclass('public.sandbox_referral_commissions') is not null then
    execute 'select count(*) from public.sandbox_referral_commissions' into v_count;
    raise notice 'sandbox_referral_commissions rows: %', v_count;
  else
    raise notice 'No public.sandbox_referral_commissions table found.';
  end if;

  if to_regclass('public.wallet_ledger') is not null then
    execute 'select count(*) from public.wallet_ledger' into v_count;
    raise notice 'wallet_ledger rows (all providers): %', v_count;
  end if;
end
$$;

rollback;
