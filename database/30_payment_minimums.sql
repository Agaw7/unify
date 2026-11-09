begin;
set local lock_timeout = '10s';

-- Keep existing deposits valid while allowing new withdrawals from PHP 60.
alter table public.money_transactions drop constraint money_transactions_amount_check;
alter table public.money_transactions add constraint money_transactions_amount_check check (
  (kind = 'deposit' and amount between 10000 and 5000000)
  or (kind = 'withdrawal' and amount between 6000 and 5000000)
  or (kind not in ('deposit', 'withdrawal') and amount between 1 and 100000000000)
);

-- Change only the limits in the installed functions. Stop if their definitions differ.
do $$
declare
  live_request text := pg_get_functiondef('public.money_request(uuid,text,bigint,text,uuid,uuid)'::regprocedure);
  sandbox_request text := pg_get_functiondef('public.request_configured_sandbox_withdrawal(uuid,numeric,uuid,uuid,boolean)'::regprocedure);
begin
  if strpos(live_request, 'p_amount<10000 or p_amount>5000000') = 0
    or strpos(live_request, 'p_amount<20000 or p_destination') = 0
    or strpos(sandbox_request, 'p_amount<100 or p_amount>50000') = 0 then
    raise exception 'Unexpected withdrawal or deposit function definition';
  end if;
  execute replace(
    replace(live_request, 'p_amount<10000 or p_amount>5000000', 'p_amount<6000 or p_amount>5000000'),
    'p_amount<20000 or p_destination', 'p_amount<30000 or p_destination'
  );
  execute replace(sandbox_request, 'p_amount<100 or p_amount>50000', 'p_amount<60 or p_amount>50000');
end $$;

notify pgrst, 'reload schema';
commit;
