#!/bin/sh
# Disposable local Postgres proof; no hosted Supabase or network required.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/saas-rls.XXXXXX")
cleanup() {
  if [ -f "$tmp/data/postmaster.pid" ]; then pg_ctl -D "$tmp/data" -m immediate -w stop >/dev/null; fi
  rm -rf "$tmp"
}
trap cleanup EXIT HUP INT TERM
initdb -D "$tmp/data" -A trust -U postgres --no-locale >/dev/null
pg_ctl -D "$tmp/data" -o "-c listen_addresses='' -c unix_socket_directories='$tmp'" -w start >/dev/null
psql -X -v ON_ERROR_STOP=1 -h "$tmp" -U postgres -d postgres <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
SQL
psql -X -v ON_ERROR_STOP=1 -h "$tmp" -U postgres -d postgres -f "$root/supabase/migrations/20260823031500_workspace_rls_qualification.sql" >/dev/null
psql -X -v ON_ERROR_STOP=1 -h "$tmp" -U postgres -d postgres -f "$root/scripts/workspace-rls-proof.sql"
psql -X -v ON_ERROR_STOP=1 -h "$tmp" -U postgres -d postgres -f "$root/supabase/migrations/20261127062537_workspace_onboarding.sql" >/dev/null
psql -X -v ON_ERROR_STOP=1 -h "$tmp" -U postgres -d postgres -f "$root/scripts/workspace-onboarding-proof.sql" >/dev/null

race_join() {
  psql -XqAt -v ON_ERROR_STOP=1 -v "invitee=$1" -h "$tmp" -U postgres -d postgres <<'SQL'
begin;
set local role authenticated;
set local request.jwt.claim.sub = :'invitee';
select case when public.join_workspace('00000000000000000000000000000000') is null
  then 'rejected' else 'joined' end;
-- Keep the first redemption lock until the concurrent request has time to enter.
do $$ begin perform pg_sleep(1); end $$;
commit;
SQL
}

race_join 00000000-0000-0000-0000-000000000005 > "$tmp/race-a" &
first=$!
race_join 00000000-0000-0000-0000-000000000006 > "$tmp/race-b" &
second=$!
wait "$first"
wait "$second"
if [ "$(sort "$tmp/race-a" "$tmp/race-b" | paste -sd ' ' -)" != 'joined rejected' ]; then
  echo 'concurrent redemption did not produce exactly one join' >&2
  exit 1
fi
echo 'workspace onboarding proof passed (local Postgres, including concurrent redemption)'
