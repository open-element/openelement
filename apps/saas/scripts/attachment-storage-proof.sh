#!/bin/sh
# Apply the ordered SaaS migrations against a disposable local Postgres
# catalog with the Supabase-owned objects that the migrations reference.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/saas-storage.XXXXXX")
cleanup() {
  if [ -f "$tmp/data/postmaster.pid" ]; then pg_ctl -D "$tmp/data" -m immediate -w stop >/dev/null; fi
  rm -rf "$tmp"
}
trap cleanup EXIT HUP INT TERM
initdb -D "$tmp/data" -A trust -U postgres --no-locale >/dev/null
pg_ctl -D "$tmp/data" -o "-c wal_level=logical -c listen_addresses='' -c unix_socket_directories='$tmp'" -w start >/dev/null
query() { psql -Xq -v ON_ERROR_STOP=1 -h "$tmp" -U postgres -d postgres "$@"; }
query <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
grant usage on schema auth to authenticated, service_role;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (
  bucket_id text not null references storage.buckets,
  name text not null,
  primary key (bucket_id, name)
);
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:cardinality(string_to_array(name, '/')) - 1]
$$;
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
create publication supabase_realtime;
SQL
for migration in "$root"/supabase/migrations/*.sql; do
  case "$migration" in
    *broker_attachment_storage.sql)
      query <<'SQL'
insert into auth.users values ('30000000-0000-4000-8000-000000000009');
insert into public.attachment_reservations values (
  '20000000-0000-4000-8000-000000000009', '30000000-0000-4000-8000-000000000009',
  '30000000-0000-4000-8000-000000000009/legacy.txt', 'legacy.txt', 101,
  'text/plain', 'clean', now() - interval '1 hour'
);
insert into public.storage_audit(user_id, reservation_id, event)
values ('30000000-0000-4000-8000-000000000009', '20000000-0000-4000-8000-000000000009', 'scan_clean');
insert into storage.objects values
  ('notes-attachments', '30000000-0000-4000-8000-000000000009/legacy.txt');
update storage.buckets set public = true where id = 'notes-attachments';
SQL
      ;;
  esac
  query --single-transaction -f "$migration"
done
query -f "$root/scripts/attachment-storage-proof.sql"
echo 'Attachment Storage policy, grants, and deletion proof passed (disposable PostgreSQL).'
