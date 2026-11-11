-- Let members submit manual GCash/Maya requests for review before verification.
-- Existing payout eligibility, ownership records, and account restrictions stay in force.
begin;
set local lock_timeout = '10s';

do $migration$
declare
  request_def text := pg_get_functiondef('public.money_request(uuid,text,bigint,text,uuid,uuid)'::regprocedure);
  guard_def text := pg_get_functiondef('public.money_guard_transaction()'::regprocedure);
  old_customer text := 'if p_kind=''withdrawal'' and (c.user_id is null or not c.verified) then raise exception ''Verified, unrestricted customer required''; end if;';
  old_destination text := 'select * into d from public.money_destinations where id=p_destination and user_id=p_user and verified for share;';
  old_destination_check text := 'if not found or d.method<>p_method or d.bic is null then raise exception ''Verified destination required''; end if;';
  old_guard text := 'and not public.money_customer_ready(new.user_id,new.destination_id) then raise exception ''Current identity/ownership approval required or account has a financial restriction''; end if;';
begin
  if strpos(request_def, 'c public.money_customers;') = 0 or strpos(request_def, old_customer) = 0
     or strpos(request_def, old_destination) = 0 or strpos(request_def, old_destination_check) = 0
     or strpos(guard_def, old_guard) = 0 then
    raise exception 'Unexpected withdrawal function definitions';
  end if;

  request_def := replace(request_def, 'c public.money_customers;', 'c public.money_customers; manual_review boolean := false;');
  request_def := replace(request_def, old_customer, $body$
  if p_kind='withdrawal' and p_method in ('gcash','maya') then
    select withdrawal_mode='admin_approval' into manual_review from public.money_settings where id=true for share;
  end if;
  if p_kind='withdrawal' and not coalesce(manual_review,false) and (c.user_id is null or not c.verified) then
    raise exception 'Verified, unrestricted customer required';
  end if;
  $body$);
  request_def := replace(request_def, old_destination, $body$
  select * into d from public.money_destinations where id=p_destination and user_id=p_user
    and (coalesce(manual_review,false) or verified) for share;
  $body$);
  request_def := replace(request_def, old_destination_check, $body$
  if not found or d.method<>p_method or (not coalesce(manual_review,false) and d.bic is null) then
    raise exception 'Valid withdrawal destination required';
  end if;
  $body$);
  execute request_def;

  guard_def := replace(guard_def, old_guard, $body$
  then
    if tg_op='INSERT' and new.status='reserved' and new.method in ('gcash','maya')
      and exists(select 1 from public.money_settings where id=true and withdrawal_mode='admin_approval')
    then
      if not public.money_deposit_ready(new.user_id) then raise exception 'Account restricted'; end if;
    elsif not public.money_customer_ready(new.user_id,new.destination_id) then
      raise exception 'Current identity/ownership approval required or account has a financial restriction';
    end if;
  end if;
  $body$);
  execute guard_def;
end $migration$;

notify pgrst, 'reload schema';
commit;
