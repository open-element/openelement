-- 20260816000000_notes.sql — RLS-protected notes table for the reference
-- starter (#983). Applies on top of a fresh Supabase project: the auth
-- schema comes from Supabase itself.
--
-- Must-not-break security rules (#983):
-- - RLS is enabled and exercised, not merely described: anon/authenticated
--   roles can never read or write rows they do not own. Anonymous access is
--   denied at the database — the application's denied branch is a UX path
--   over a hard RLS floor, not the only protection.
-- - No cross-user access: every policy is scoped to auth.uid() = user_id.
-- - The service-role key bypasses RLS by design and never leaves the server.

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notes enable row level security;

create policy "notes: owner reads own rows"
  on public.notes for select
  to authenticated
  using (auth.uid() = user_id);

create policy "notes: owner inserts own rows"
  on public.notes for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "notes: owner updates own rows"
  on public.notes for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "notes: owner deletes own rows"
  on public.notes for delete
  to authenticated
  using (auth.uid() = user_id);
