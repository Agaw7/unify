-- Review and verify the backup restore before applying to AUREVIA production.
begin;
set local lock_timeout = '10s';

do $$
begin
  if not exists (
    select 1 from pg_class
    where oid = 'storage.objects'::regclass and relrowsecurity
  ) then
    raise exception 'Storage object row security must be enabled';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'manual_qrph_deposits'
      and column_name = 'receipt_path'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'money_transactions'
      and column_name = 'payout_proof_path'
  ) then
    raise exception 'Expected production proof columns are missing';
  end if;
end $$;

drop policy if exists "Deny client access to manual deposit receipts" on storage.objects;
create policy "Deny client access to manual deposit receipts" on storage.objects
  as restrictive for all to anon, authenticated
  using (bucket_id <> 'manual-deposit-receipts')
  with check (bucket_id <> 'manual-deposit-receipts');

drop policy if exists "Deny client access to payout proof images" on storage.objects;
create policy "Deny client access to payout proof images" on storage.objects
  as restrictive for all to anon, authenticated
  using (bucket_id <> 'withdrawal-payout-proofs')
  with check (bucket_id <> 'withdrawal-payout-proofs');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('manual-deposit-receipts', 'manual-deposit-receipts', false, 5242880, array['image/png', 'image/jpeg']),
  ('withdrawal-payout-proofs', 'withdrawal-payout-proofs', false, 5242880, array['image/png', 'image/jpeg']);

commit;
