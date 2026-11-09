-- Additive evidence history only. This migration cannot enable live payments.
begin;
create table if not exists public.payment_readiness_reviews (
  id uuid primary key default gen_random_uuid(),
  approval_type text not null check (approval_type in ('merchant','regulatory','palawan','disbursement')),
  status text not null check (status in ('submitted','independently_verified','rejected','expired')),
  evidence_reference text not null check (length(trim(evidence_reference)) between 5 and 500),
  reviewer_reference text not null check (length(trim(reviewer_reference)) between 5 and 200),
  reviewed_at timestamptz not null default now()
);
alter table public.payment_readiness_reviews enable row level security;
revoke all on public.payment_readiness_reviews from public,anon,authenticated,service_role;
grant select on public.payment_readiness_reviews to service_role;
-- No app-side insert/update grant and no activation RPC. Independently validated
-- evidence is recorded through a separately reviewed database change.
create or replace function public.payment_readiness_history_immutable() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'Payment readiness reviews are append-only'; end $$;
drop trigger if exists payment_readiness_reviews_immutable on public.payment_readiness_reviews;
create trigger payment_readiness_reviews_immutable before update or delete on public.payment_readiness_reviews
for each row execute function public.payment_readiness_history_immutable();
revoke all on function public.payment_readiness_history_immutable() from public,anon,authenticated;
commit;
