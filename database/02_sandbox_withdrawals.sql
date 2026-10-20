begin;

alter table public.sandbox_withdrawal_requests
  add column if not exists payment_account_id uuid,
  add column if not exists idempotency_key uuid;

create unique index if not exists sandbox_withdrawals_user_idempotency
  on public.sandbox_withdrawal_requests(user_id, idempotency_key);

create index if not exists sandbox_withdrawals_user_history
  on public.sandbox_withdrawal_requests(user_id, created_at desc);

alter table public.sandbox_withdrawal_requests enable row level security;
alter table public.sandbox_wallets enable row level security;

drop policy if exists "View own sandbox withdrawals" on public.sandbox_withdrawal_requests;
create policy "View own sandbox withdrawals" on public.sandbox_withdrawal_requests
  for select to authenticated using (user_id = (select auth.uid()));

grant select on public.sandbox_withdrawal_requests to authenticated;
revoke insert, update, delete on public.sandbox_withdrawal_requests from anon, authenticated;

-- This procedure uses the caller's JWT, not a user-supplied user ID.
-- A row lock and idempotency key prevent double reservations.
create or replace function public.request_sandbox_withdrawal(
  p_amount numeric,
  p_payment_account_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_balance numeric(18,2);
  v_request_id uuid;
  v_existing public.sandbox_withdrawal_requests%rowtype;
  v_method text;
begin
  if v_user is null then
    raise exception 'Authentication required';
  end if;
  if p_amount is null or p_amount < 100 or p_amount > 50000
     or p_amount <> round(p_amount, 2) then
    raise exception 'Enter an amount from PHP 100 to PHP 50,000';
  end if;
  if p_idempotency_key is null or p_payment_account_id is null then
    raise exception 'Missing request key or account';
  end if;

  select provider into v_method
  from public.payment_accounts
  where id = p_payment_account_id and user_id = v_user;
  if v_method not in ('gcash', 'maya') or v_method is null then
    raise exception 'Select a valid saved GCash or Maya account';
  end if;

  -- Serialize requests for the same member.
  select remaining_balance into v_balance
  from public.sandbox_wallets
  where user_id = v_user
  for update;
  if not found then
    raise exception 'Sandbox wallet not found';
  end if;

  select * into v_existing
  from public.sandbox_withdrawal_requests
  where user_id = v_user and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.amount <> p_amount
       or v_existing.payment_account_id is distinct from p_payment_account_id then
      raise exception 'Request key reused with different details';
    end if;
    return jsonb_build_object('id', v_existing.id, 'status', v_existing.status,
      'remaining_balance', v_balance, 'mode', 'simulation', 'replayed', true);
  end if;

  if v_balance < p_amount then
    raise exception 'Insufficient simulated Remaining Balance';
  end if;

  update public.sandbox_wallets
  set remaining_balance = remaining_balance - p_amount
  where user_id = v_user;

  insert into public.sandbox_withdrawal_requests
    (user_id, amount, currency, status, payment_method,
     payment_account_id, idempotency_key)
  values (v_user, p_amount, 'PHP', 'reserved', v_method,
          p_payment_account_id, p_idempotency_key)
  returning id into v_request_id;

  return jsonb_build_object('id', v_request_id, 'status', 'reserved',
    'remaining_balance', v_balance - p_amount,
    'mode', 'simulation', 'replayed', false);
end;
$$;

revoke all on function public.request_sandbox_withdrawal(numeric,uuid,uuid)
  from public, anon;
grant execute on function public.request_sandbox_withdrawal(numeric,uuid,uuid)
  to authenticated;

notify pgrst, 'reload schema';
commit;
