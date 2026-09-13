-- Supabase projects created after the 2026 Data API privilege change do not
-- expose new public tables automatically. RLS remains mandatory but is not a
-- substitute for object privileges: grant only the direct Data API operations
-- exercised by the reference app and its qualification workflows.

revoke all on table
  public.notes,
  public.admin_audit,
  public.attachment_reservations,
  public.storage_audit,
  public.attachment_scan_dead_letters,
  public.orders,
  public.stripe_events,
  public.payment_products,
  public.workspaces,
  public.workspace_members,
  public.workspace_records
from anon, authenticated, service_role;

revoke all on sequence
  public.admin_audit_id_seq,
  public.storage_audit_id_seq,
  public.workspace_records_id_seq
from anon, authenticated, service_role;

-- Signed-in browser/server requests. RLS still decides which rows are visible.
grant select, insert, update, delete on table public.notes to authenticated;
grant select on table public.admin_audit to authenticated;
grant select on table public.attachment_reservations to authenticated;
grant select on table public.storage_audit to authenticated;
grant select on table public.orders to authenticated;
grant select on table public.workspaces, public.workspace_members to authenticated;
grant select, insert, update, delete on table public.workspace_records to authenticated;
grant usage, select on sequence public.workspace_records_id_seq to authenticated;

-- Trusted tooling uses direct PostgREST only to seed/query notes, inspect scan
-- state and clean quota fixtures. Lifecycle workers otherwise use explicit
-- SECURITY DEFINER RPCs; they do not need blanket table DML.
grant select, insert on table public.notes to service_role;
grant select, delete on table public.attachment_reservations to service_role;
grant select on table public.attachment_scan_dead_letters to service_role;

-- Re-establish the complete callable API from an empty privilege baseline.
-- Trigger functions intentionally receive no Data API EXECUTE privilege.
do $$
declare
  target_function regprocedure;
begin
  for target_function in
    select p.oid::regprocedure
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated, service_role',
      target_function
    );
  end loop;
end;
$$;

grant execute on function public.reserve_attachment(uuid, text, text, bigint, text),
  public.finalize_attachment(uuid),
  public.release_attachment(uuid),
  public.release_attachment_by_key(text),
  public.list_downloadable_attachments(),
  public.list_attachment_scan_dead_letters(),
  public.request_attachment_scan_replay(uuid),
  public.create_checkout_order(text, uuid),
  public.list_payment_event_dead_letters(),
  public.request_payment_event_replay(text),
  public.is_workspace_member(uuid),
  public.is_workspace_admin(uuid)
to authenticated;

grant execute on function public.list_stale_attachment_reservations(),
  public.list_pending_attachment_scans(),
  public.complete_attachment_scan(uuid, text, text),
  public.release_stale_attachment(uuid),
  public.record_attachment_scan_dead_letter(uuid, text),
  public.list_requested_attachment_scan_replays(),
  public.mark_attachment_scan_replayed(uuid),
  public.authorize_attachment_scan(uuid, text),
  public.receive_stripe_event(text, text, bigint, boolean, text, jsonb),
  public.process_stripe_event(text),
  public.record_payment_event_dead_letter(text),
  public.list_pending_payment_events(),
  public.mark_payment_event_replay_enqueued(text),
  public.attach_checkout_session(uuid, text),
  public.mark_checkout_creation_failed(uuid)
to service_role;

-- Fail the migration if the concrete catalog differs from the reviewed
-- role/object call graph. This proves object privileges independently of RLS.
do $$
begin
  if exists (
    select grantee, table_name, privilege_type
    from information_schema.table_privileges
    where table_schema = 'public'
      and grantee in ('anon', 'authenticated', 'service_role')
      and table_name in (
        'notes', 'admin_audit', 'attachment_reservations', 'storage_audit',
        'attachment_scan_dead_letters', 'orders', 'stripe_events',
        'payment_products', 'workspaces', 'workspace_members', 'workspace_records'
      )
    except
    select * from (values
      ('authenticated', 'notes', 'SELECT'),
      ('authenticated', 'notes', 'INSERT'),
      ('authenticated', 'notes', 'UPDATE'),
      ('authenticated', 'notes', 'DELETE'),
      ('authenticated', 'admin_audit', 'SELECT'),
      ('authenticated', 'attachment_reservations', 'SELECT'),
      ('authenticated', 'storage_audit', 'SELECT'),
      ('authenticated', 'orders', 'SELECT'),
      ('authenticated', 'workspaces', 'SELECT'),
      ('authenticated', 'workspace_members', 'SELECT'),
      ('authenticated', 'workspace_records', 'SELECT'),
      ('authenticated', 'workspace_records', 'INSERT'),
      ('authenticated', 'workspace_records', 'UPDATE'),
      ('authenticated', 'workspace_records', 'DELETE'),
      ('service_role', 'notes', 'SELECT'),
      ('service_role', 'notes', 'INSERT'),
      ('service_role', 'attachment_reservations', 'SELECT'),
      ('service_role', 'attachment_reservations', 'DELETE'),
      ('service_role', 'attachment_scan_dead_letters', 'SELECT')
    ) expected(grantee, table_name, privilege_type)
  ) or exists (
    select * from (values
      ('authenticated', 'notes', 'SELECT'),
      ('authenticated', 'notes', 'INSERT'),
      ('authenticated', 'notes', 'UPDATE'),
      ('authenticated', 'notes', 'DELETE'),
      ('authenticated', 'admin_audit', 'SELECT'),
      ('authenticated', 'attachment_reservations', 'SELECT'),
      ('authenticated', 'storage_audit', 'SELECT'),
      ('authenticated', 'orders', 'SELECT'),
      ('authenticated', 'workspaces', 'SELECT'),
      ('authenticated', 'workspace_members', 'SELECT'),
      ('authenticated', 'workspace_records', 'SELECT'),
      ('authenticated', 'workspace_records', 'INSERT'),
      ('authenticated', 'workspace_records', 'UPDATE'),
      ('authenticated', 'workspace_records', 'DELETE'),
      ('service_role', 'notes', 'SELECT'),
      ('service_role', 'notes', 'INSERT'),
      ('service_role', 'attachment_reservations', 'SELECT'),
      ('service_role', 'attachment_reservations', 'DELETE'),
      ('service_role', 'attachment_scan_dead_letters', 'SELECT')
    ) expected(grantee, table_name, privilege_type)
    except
    select grantee, table_name, privilege_type
    from information_schema.table_privileges
    where table_schema = 'public'
      and grantee in ('anon', 'authenticated', 'service_role')
      and table_name in (
        'notes', 'admin_audit', 'attachment_reservations', 'storage_audit',
        'attachment_scan_dead_letters', 'orders', 'stripe_events',
        'payment_products', 'workspaces', 'workspace_members', 'workspace_records'
      )
  ) then
    raise exception 'unexpected public table privilege matrix';
  end if;

  if not pg_catalog.has_sequence_privilege(
    'authenticated', 'public.workspace_records_id_seq', 'USAGE'
  )
    or not pg_catalog.has_sequence_privilege(
      'authenticated', 'public.workspace_records_id_seq', 'SELECT'
    )
    or exists (
      select 1
      from unnest(array['anon', 'authenticated', 'service_role']) role_name
      cross join unnest(array[
        'admin_audit_id_seq', 'storage_audit_id_seq', 'workspace_records_id_seq'
      ]) sequence_name
      cross join unnest(array['USAGE', 'SELECT', 'UPDATE']) privilege_name
      where pg_catalog.has_sequence_privilege(
        role_name,
        format('public.%I', sequence_name),
        privilege_name
      )
        and not (
          role_name = 'authenticated'
          and sequence_name = 'workspace_records_id_seq'
          and privilege_name in ('USAGE', 'SELECT')
        )
    )
  then
    raise exception 'unexpected public sequence privilege matrix';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    cross join (values ('anon'), ('authenticated'), ('service_role')) roles(role_name)
    where n.nspname = 'public'
      and pg_catalog.has_function_privilege(roles.role_name, p.oid, 'EXECUTE')
      and (roles.role_name, p.oid::regprocedure::text) not in (
        ('authenticated', 'reserve_attachment(uuid,text,text,bigint,text)'),
        ('authenticated', 'finalize_attachment(uuid)'),
        ('authenticated', 'release_attachment(uuid)'),
        ('authenticated', 'release_attachment_by_key(text)'),
        ('authenticated', 'list_downloadable_attachments()'),
        ('authenticated', 'list_attachment_scan_dead_letters()'),
        ('authenticated', 'request_attachment_scan_replay(uuid)'),
        ('authenticated', 'create_checkout_order(text,uuid)'),
        ('authenticated', 'list_payment_event_dead_letters()'),
        ('authenticated', 'request_payment_event_replay(text)'),
        ('authenticated', 'is_workspace_member(uuid)'),
        ('authenticated', 'is_workspace_admin(uuid)'),
        ('service_role', 'list_stale_attachment_reservations()'),
        ('service_role', 'list_pending_attachment_scans()'),
        ('service_role', 'complete_attachment_scan(uuid,text,text)'),
        ('service_role', 'release_stale_attachment(uuid)'),
        ('service_role', 'record_attachment_scan_dead_letter(uuid,text)'),
        ('service_role', 'list_requested_attachment_scan_replays()'),
        ('service_role', 'mark_attachment_scan_replayed(uuid)'),
        ('service_role', 'authorize_attachment_scan(uuid,text)'),
        ('service_role', 'receive_stripe_event(text,text,bigint,boolean,text,jsonb)'),
        ('service_role', 'process_stripe_event(text)'),
        ('service_role', 'record_payment_event_dead_letter(text)'),
        ('service_role', 'list_pending_payment_events()'),
        ('service_role', 'mark_payment_event_replay_enqueued(text)'),
        ('service_role', 'attach_checkout_session(uuid,text)'),
        ('service_role', 'mark_checkout_creation_failed(uuid)')
      )
  ) then
    raise exception 'unexpected public function EXECUTE privilege';
  end if;
end;
$$;
