-- Server authorization mirrors this policy by reading app_metadata.role.
-- user_metadata is user-writable and is deliberately never consulted.

create table public.admin_audit (
  id bigint generated always as identity primary key,
  actor_id uuid not null references auth.users(id),
  action text not null,
  target_type text not null,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.admin_audit enable row level security;

create policy "admin audit: admins read"
  on public.admin_audit for select to authenticated
  using ((select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin');

create policy "admin audit: admins append"
  on public.admin_audit for insert to authenticated
  with check (
    (select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin'
    and actor_id = (select auth.uid())
  );

create policy "notes: admins read all rows"
  on public.notes for select to authenticated
  using ((select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin');

create or replace function public.reject_audit_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'admin_audit records are immutable';
end;
$$;

create trigger admin_audit_immutable
before update or delete on public.admin_audit
for each row execute function public.reject_audit_mutation();
