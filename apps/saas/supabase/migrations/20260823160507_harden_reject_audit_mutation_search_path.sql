-- Pin name resolution even though this trigger currently references no database
-- objects. Keeping the setting explicit prevents future edits from inheriting a
-- caller-controlled search_path.
alter function public.reject_audit_mutation()
  set search_path = '';

do $migration$
begin
  if coalesce(
    (
      select p.proconfig @> array['search_path=""']::text[]
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'reject_audit_mutation'
        and p.pronargs = 0
    ),
    false
  ) is not true then
    raise exception 'reject_audit_mutation search_path is not pinned to empty';
  end if;
end;
$migration$;
