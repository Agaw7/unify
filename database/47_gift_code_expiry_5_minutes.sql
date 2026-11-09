begin;
set local lock_timeout = '10s';

alter table public.money_gift_codes
  alter column expires_at set default (now() + interval '5 minutes');

commit;
