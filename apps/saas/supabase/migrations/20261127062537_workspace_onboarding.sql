-- Only the invoker wrappers are in the Data API's exposed schema.
create schema workspace_onboarding;
revoke all on schema workspace_onboarding from public, anon, authenticated, service_role;
grant usage on schema workspace_onboarding to authenticated;

create table workspace_onboarding.invitations (
  code_hash bytea primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  expires_at timestamptz not null
);
alter table workspace_onboarding.invitations enable row level security;
revoke all on table workspace_onboarding.invitations from public, anon, authenticated, service_role;
create index workspace_invitations_workspace_id_idx on workspace_onboarding.invitations (workspace_id);

create function workspace_onboarding.create_workspace(workspace_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  new_workspace uuid;
begin
  if actor is null then
    raise exception using errcode = '42501', message = 'Sign in required';
  end if;
  workspace_name := pg_catalog.btrim(workspace_name);
  if workspace_name is null or pg_catalog.char_length(workspace_name) not between 1 and 120 then
    raise exception using errcode = '22023', message = 'Invalid workspace name';
  end if;

  insert into public.workspaces (name, created_by) values (workspace_name, actor)
    returning id into new_workspace;
  insert into public.workspace_members (workspace_id, user_id, role)
    values (new_workspace, actor, 'admin');
  return new_workspace;
end;
$$;

create function workspace_onboarding.issue_invitation(target_workspace uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  code text;
begin
  if actor is null then
    raise exception using errcode = '42501', message = 'Sign in required';
  end if;
  -- Hold current admin membership until issuance commits.
  perform 1 from public.workspace_members as membership
    where membership.workspace_id = target_workspace
      and membership.user_id = actor and membership.role = 'admin'
    for share;
  if not found then
    raise exception using errcode = '42501', message = 'Workspace administrator required';
  end if;

  -- UUIDv4 supplies 122 random bits. SHA-256 is built into the supported Postgres.
  code := pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
  insert into workspace_onboarding.invitations (code_hash, workspace_id, expires_at)
    values (
      pg_catalog.sha256(pg_catalog.convert_to(code, 'UTF8')),
      target_workspace,
      pg_catalog.clock_timestamp() + interval '24 hours'
    );
  return code;
end;
$$;

create function workspace_onboarding.join_workspace(invitation_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  digest bytea;
  target_workspace uuid;
  expiry timestamptz;
begin
  if actor is null then
    raise exception using errcode = '42501', message = 'Sign in required';
  end if;
  if invitation_code is null or invitation_code !~ '^[0-9a-f]{32}$' then
    return null;
  end if;

  digest := pg_catalog.sha256(pg_catalog.convert_to(invitation_code, 'UTF8'));
  -- Serialize redemptions for the same code. Check expiry after acquiring the lock.
  select invitation.workspace_id, invitation.expires_at into target_workspace, expiry
    from workspace_onboarding.invitations as invitation
    where invitation.code_hash = digest
    for update;
  if not found or expiry <= pg_catalog.clock_timestamp() then
    return null;
  end if;

  -- A current member, including an admin, cannot change role or consume the code.
  insert into public.workspace_members (workspace_id, user_id, role)
    values (target_workspace, actor, 'member')
    on conflict (workspace_id, user_id) do nothing;
  if not found then
    return null;
  end if;
  delete from workspace_onboarding.invitations as invitation where invitation.code_hash = digest;
  return target_workspace;
end;
$$;

create function public.create_workspace(workspace_name text)
returns uuid
language sql
security invoker
set search_path = ''
as $$ select workspace_onboarding.create_workspace(workspace_name) $$;

create function public.issue_workspace_invitation(target_workspace uuid)
returns text
language sql
security invoker
set search_path = ''
as $$ select workspace_onboarding.issue_invitation(target_workspace) $$;

create function public.join_workspace(invitation_code text)
returns uuid
language sql
security invoker
set search_path = ''
as $$ select workspace_onboarding.join_workspace(invitation_code) $$;

revoke all on function
  workspace_onboarding.create_workspace(text),
  workspace_onboarding.issue_invitation(uuid),
  workspace_onboarding.join_workspace(text),
  public.create_workspace(text),
  public.issue_workspace_invitation(uuid),
  public.join_workspace(text)
from public, anon, authenticated, service_role;

grant execute on function
  workspace_onboarding.create_workspace(text),
  workspace_onboarding.issue_invitation(uuid),
  workspace_onboarding.join_workspace(text),
  public.create_workspace(text),
  public.issue_workspace_invitation(uuid),
  public.join_workspace(text)
to authenticated;
