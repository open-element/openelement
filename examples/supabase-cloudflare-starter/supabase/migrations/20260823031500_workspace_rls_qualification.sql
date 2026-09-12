-- Minimal multi-tenant qualification schema (#1114). This is deliberately a
-- fixture-sized data model, not an application-owned CRM abstraction.

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('member', 'admin')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.workspace_records (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  status text not null check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workspace_creator_created_id_idx
  on public.workspaces (created_by, created_at desc, id);
create index workspace_members_user_workspace_idx
  on public.workspace_members (user_id, workspace_id);
create index workspace_records_creator_created_id_idx
  on public.workspace_records (created_by, created_at desc, id desc);
create index workspace_records_workspace_created_id_idx
  on public.workspace_records (workspace_id, created_at desc, id desc);
create index workspace_records_workspace_status_created_id_idx
  on public.workspace_records (workspace_id, status, created_at desc, id desc);
create index workspace_records_workspace_title_prefix_idx
  on public.workspace_records (workspace_id, lower(title) text_pattern_ops, created_at desc, id desc);

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_records enable row level security;

create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members
    where workspace_id = target_workspace_id
      and user_id = (select auth.uid())
  );
$$;

create or replace function public.is_workspace_admin(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members
    where workspace_id = target_workspace_id
      and user_id = (select auth.uid())
      and role = 'admin'
  );
$$;

revoke all on function public.is_workspace_member(uuid) from public, anon;
revoke all on function public.is_workspace_admin(uuid) from public, anon;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.is_workspace_admin(uuid) to authenticated;

create policy "workspaces: members read"
  on public.workspaces for select to authenticated
  using ((select public.is_workspace_member(id)));

create policy "workspace members: members read"
  on public.workspace_members for select to authenticated
  using ((select public.is_workspace_member(workspace_id)));

create policy "workspace records: members read"
  on public.workspace_records for select to authenticated
  using ((select public.is_workspace_member(workspace_id)));

create policy "workspace records: members create"
  on public.workspace_records for insert to authenticated
  with check (
    (select public.is_workspace_member(workspace_id))
    and created_by = (select auth.uid())
  );

create policy "workspace records: creators or admins update"
  on public.workspace_records for update to authenticated
  using (
    (select public.is_workspace_member(workspace_id))
    and (created_by = (select auth.uid()) or (select public.is_workspace_admin(workspace_id)))
  )
  with check (
    (select public.is_workspace_member(workspace_id))
    and (created_by = (select auth.uid()) or (select public.is_workspace_admin(workspace_id)))
  );

create policy "workspace records: creators or admins delete"
  on public.workspace_records for delete to authenticated
  using (
    (select public.is_workspace_member(workspace_id))
    and (created_by = (select auth.uid()) or (select public.is_workspace_admin(workspace_id)))
  );

revoke all on public.workspaces, public.workspace_members, public.workspace_records from anon;
revoke all on public.workspaces, public.workspace_members, public.workspace_records from authenticated;
grant select on public.workspaces, public.workspace_members to authenticated;
grant select, insert, update, delete on public.workspace_records to authenticated;
grant usage, select on sequence public.workspace_records_id_seq to authenticated;
