begin;

-- Preserve referral paths and commission history. Only active accounts appear in Friends.
do $$
declare
  definition text := pg_get_functiondef('public.money_live_team(uuid)'::regprocedure);
  visible_members constant text := 'from tree where level=l and exists (select 1 from auth.users active_user where active_user.id=tree.id and active_user.deleted_at is null)';
begin
  if strpos(definition, 'from tree where level=l)') = 0
    or strpos(definition, 'from tree where level=l order by') = 0 then
    raise exception 'Unexpected Friends function definition';
  end if;
  execute replace(
    replace(definition, 'from tree where level=l)', visible_members || ')'),
    'from tree where level=l order by', visible_members || ' order by'
  );
end $$;

commit;
