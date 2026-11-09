begin;
set local lock_timeout = '10s';

alter table public.money_transactions
  add column withdrawal_fee bigint not null default 0,
  add constraint money_transactions_withdrawal_fee_check
    check (withdrawal_fee = 0 or (kind = 'withdrawal' and withdrawal_fee > 0 and withdrawal_fee < amount));

create function public.money_request_withdrawal(
  p_user uuid, p_amount bigint, p_method text, p_key uuid, p_destination uuid
)
returns public.money_transactions
language plpgsql security definer set search_path = ''
as $$
declare
  withdrawal public.money_transactions;
  already_exists boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));
  select exists (
    select 1 from public.money_transactions
    where user_id = p_user and kind = 'withdrawal' and idempotency_key = p_key
  ) into already_exists;
  withdrawal := public.money_request(p_user, 'withdrawal', p_amount, p_method, p_key, p_destination);

  if not already_exists then
    update public.money_transactions
    set withdrawal_fee = (amount + 10) / 20
    where id = withdrawal.id
    returning * into withdrawal;
  end if;
  return withdrawal;
end
$$;

revoke all on function public.money_request_withdrawal(uuid,bigint,text,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.money_request_withdrawal(uuid,bigint,text,uuid,uuid)
  to service_role;
notify pgrst, 'reload schema';
commit;
