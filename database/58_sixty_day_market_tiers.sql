-- Update the seven current Market offers. Existing contracts retain their terms.
begin;
set local lock_timeout = '10s';

do $$
declare
  changed integer;
begin
  update public.investment_products
     set duration_days = 60
   where name in (
     'G5 Pro 4K Camera', 'UNVR 4-Bay NVR', 'G4 Doorbell Pro',
     'UniFi U6 Pro AP', 'G5 Bullet Camera', 'G5 Dome Camera', 'G5 Flex Camera'
   )
   and duration_days in (30,60);
  get diagnostics changed = row_count;
  if changed <> 7 then
    raise exception 'Expected seven Market tiers with 30- or 60-day terms, found %', changed;
  end if;
end $$;

commit;
