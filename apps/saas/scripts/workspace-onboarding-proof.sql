insert into auth.users values
  ('00000000-0000-0000-0000-000000000005'),
  ('00000000-0000-0000-0000-000000000006');

-- Simulate a failure after the workspace insert and prove the creator and
-- workspace cannot be committed independently.
alter table public.workspace_members add constraint proof_reject_creator
  check (user_id <> '00000000-0000-0000-0000-000000000006') not valid;

do $$
declare
  alice uuid := '00000000-0000-0000-0000-000000000001';
  existing_member uuid := '00000000-0000-0000-0000-000000000002';
  unrelated_workspace uuid := '10000000-0000-0000-0000-000000000002';
  invitee uuid := '00000000-0000-0000-0000-000000000004';
  blocked_creator uuid := '00000000-0000-0000-0000-000000000006';
  workspace uuid;
  code text;
  expired text;
begin
  if exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where (n.nspname = 'workspace_onboarding' or
           n.nspname = 'public' and p.proname in ('create_workspace', 'issue_workspace_invitation', 'join_workspace'))
      and (p.prosecdef <> (n.nspname = 'workspace_onboarding') or
           pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') or
           pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') or
           not pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  ) then
    raise exception 'unexpected onboarding function privilege or execution context';
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.create_workspace('unsigned');
    raise exception 'identity-free workspace creation succeeded';
  exception when insufficient_privilege then null; end;
  begin
    perform public.issue_workspace_invitation(unrelated_workspace);
    raise exception 'identity-free issuance succeeded';
  exception when insufficient_privilege then null; end;
  begin
    perform public.join_workspace('00000000000000000000000000000000');
    raise exception 'identity-free redemption succeeded';
  exception when insufficient_privilege then null; end;

  perform set_config('request.jwt.claim.sub', blocked_creator::text, true);
  begin
    perform public.create_workspace('must roll back');
    raise exception 'creation ignored failed membership insert';
  exception when check_violation then null; end;
  reset role;
  if exists (select 1 from public.workspaces where created_by = blocked_creator) then
    raise exception 'failed membership left an orphan workspace';
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', alice::text, true);
  workspace := public.create_workspace('  Onboarding  ');
  if not exists (select 1 from public.workspaces where id = workspace and name = 'Onboarding' and created_by = alice)
     or not exists (select 1 from public.workspace_members where workspace_id = workspace and user_id = alice and role = 'admin') then
    raise exception 'creator did not receive admin membership';
  end if;
  begin
    perform public.issue_workspace_invitation(unrelated_workspace);
    raise exception 'workspace admin issued against an unrelated workspace';
  exception when insufficient_privilege then null; end;

  code := public.issue_workspace_invitation(workspace);
  expired := public.issue_workspace_invitation(workspace);
  if code is null or code !~ '^[0-9a-f]{32}$' or code is not distinct from expired then
    raise exception 'unexpected code format or duplicate code';
  end if;
  if public.join_workspace(code) is not null then
    raise exception 'creator consumed their own invitation';
  end if;
  begin
    perform 1 from workspace_onboarding.invitations;
    raise exception 'authenticated role could read the invitation table';
  exception when insufficient_privilege then null; end;
  reset role;

  if not exists (
    select 1 from workspace_onboarding.invitations
    where code_hash = pg_catalog.sha256(pg_catalog.convert_to(code, 'UTF8'))
      and workspace_id = workspace and expires_at > pg_catalog.clock_timestamp()
  ) then
    raise exception 'issued code did not yield a live workspace-bound digest';
  end if;
  update workspace_onboarding.invitations set expires_at = pg_catalog.clock_timestamp() - interval '1 second'
    where code_hash = pg_catalog.sha256(pg_catalog.convert_to(expired, 'UTF8'));

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', invitee::text, true);
  if exists (select 1 from public.workspaces where id = workspace) then
    raise exception 'invitee could read workspace before joining';
  end if;
  if public.join_workspace(expired) is not null or public.join_workspace('invalid') is not null then
    raise exception 'expired or malformed invitation redeemed';
  end if;
  if public.join_workspace(code) is distinct from workspace then
    raise exception 'valid invitation did not redeem';
  end if;
  if not exists (select 1 from public.workspace_members where workspace_id = workspace and user_id = invitee and role = 'member')
     or not exists (select 1 from public.workspaces where id = workspace)
     or exists (select 1 from public.workspaces where id = unrelated_workspace) then
    raise exception 'redemption failed to assign scoped member access';
  end if;
  begin
    perform public.issue_workspace_invitation(workspace);
    raise exception 'member issued a new invitation';
  exception when insufficient_privilege then null; end;

  perform set_config('request.jwt.claim.sub', existing_member::text, true);
  if public.join_workspace(code) is not null then
    raise exception 'code replay succeeded under a different identity';
  end if;
end;
$$;

alter table public.workspace_members drop constraint proof_reject_creator;

-- Static fixture digest for the two independent connections in the shell test.
insert into workspace_onboarding.invitations (code_hash, workspace_id, expires_at)
values (
  pg_catalog.sha256(pg_catalog.convert_to('00000000000000000000000000000000', 'UTF8')),
  '10000000-0000-0000-0000-000000000002',
  pg_catalog.clock_timestamp() + interval '1 minute'
);
