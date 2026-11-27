-- Browser tokens may read their reservation rows. Only the app's trusted
-- server and maintenance processes can touch the corresponding Storage objects.
update storage.buckets set public = false where id = 'notes-attachments' and public is distinct from false;

drop policy "attachments: owner reads own folder" on storage.objects;
drop policy "attachments: owner uploads own folder" on storage.objects;
drop policy "attachments: owner deletes own folder" on storage.objects;
create policy "attachments: server storage only" on storage.objects
  as restrictive for all to anon, authenticated
  using (bucket_id <> 'notes-attachments')
  with check (bucket_id <> 'notes-attachments');

-- Earlier scans may describe bytes that owners could still replace. Preserve
-- each reservation and its quota while making a broker-era scan mandatory.
alter table public.storage_audit drop constraint storage_audit_event_check;
alter table public.storage_audit add constraint storage_audit_event_check check (event in (
  'upload_reserved', 'upload_pending_scan', 'upload_failed', 'delete_requested',
  'deleted', 'scan_clean', 'scan_quarantined', 'scan_dead_letter',
  'scan_replay_requested', 'scan_replayed', 'stale_released', 'scan_requeued'
));
with requeued as (
  update public.attachment_reservations as r set state = 'pending_scan'
  where r.state = 'clean'
  returning r.id, r.user_id
)
insert into public.storage_audit(user_id, reservation_id, event)
  select r.user_id, r.id, 'scan_requeued' from requeued as r;

revoke all on function
  public.finalize_attachment(uuid),
  public.release_attachment(uuid),
  public.release_attachment_by_key(text),
  public.request_attachment_delete(text),
  public.complete_attachment_delete(text),
  public.release_stale_attachment(uuid),
  public.authorize_attachment_scan(uuid, text),
  public.complete_attachment_scan(uuid, text, text)
from public, anon, authenticated, service_role;

create schema attachment_broker;
revoke all on schema attachment_broker from public, anon, authenticated, service_role;
grant usage on schema attachment_broker to service_role;

-- A late Queue delivery can outlive its reservation. Keep only a digest of
-- the original key in a private table, written atomically with quota release.
create table attachment_broker.deleted_scan_targets (
  reservation_id uuid not null,
  object_key_digest bytea not null,
  primary key (reservation_id, object_key_digest)
);
alter table attachment_broker.deleted_scan_targets enable row level security;
revoke all on table attachment_broker.deleted_scan_targets from public, anon, authenticated, service_role;

create function attachment_broker.was_deleted(reservation_id uuid, target_key text)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from attachment_broker.deleted_scan_targets as d
    where d.reservation_id = was_deleted.reservation_id
      and d.object_key_digest = pg_catalog.sha256(pg_catalog.convert_to(target_key, 'UTF8'))
  );
$$;
revoke all on function attachment_broker.was_deleted(uuid, text)
  from public, anon, authenticated, service_role;


create function attachment_broker.finish_upload(reservation_id uuid, target_owner uuid, target_key text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.attachment_reservations as r set state = 'pending_scan'
    where r.id = reservation_id and r.user_id = target_owner and r.object_key = target_key
      and r.state = 'reserved' and exists (
        select 1 from storage.objects as o
        where o.bucket_id = 'notes-attachments' and o.name = target_key
      );
  if not found then raise exception 'attachment reservation or object not found'; end if;
  insert into public.storage_audit(user_id, reservation_id, event)
    values (target_owner, reservation_id, 'upload_pending_scan');
end;
$$;

create function attachment_broker.begin_delete(reservation_id uuid, target_owner uuid, upload_failed boolean)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  target_key text;
  due timestamptz;
begin
  select r.object_key, r.delete_requested_at into target_key, due
    from public.attachment_reservations as r
    where r.id = reservation_id and r.user_id = target_owner
      and r.state = 'deleting'
    for update;
  if found then
    return case when due <= pg_catalog.now() then target_key end;
  end if;

  update public.attachment_reservations as r
    set state = 'deleting',
        delete_requested_at = case when upload_failed then
          greatest(pg_catalog.now(), r.created_at + interval '15 minutes')
          else pg_catalog.now() end
    where r.id = reservation_id and r.user_id = target_owner
      and r.state <> 'deleting' and (upload_failed or r.state <> 'reserved')
    returning r.object_key, r.delete_requested_at into target_key, due;
  if found then
    insert into public.storage_audit(user_id, reservation_id, event)
      values (target_owner, reservation_id, 'delete_requested');
  end if;
  return case when due <= pg_catalog.now() then target_key end;
end;
$$;

create function public.finish_attachment_upload(reservation_id uuid, target_owner uuid, target_key text)
returns void language sql security invoker set search_path = '' as $$
  select attachment_broker.finish_upload(reservation_id, target_owner, target_key);
$$;

create function public.begin_attachment_delete(reservation_id uuid, target_owner uuid, upload_failed boolean)
returns text language sql security invoker set search_path = '' as $$
  select attachment_broker.begin_delete(reservation_id, target_owner, upload_failed);
$$;

revoke all on function
  attachment_broker.finish_upload(uuid, uuid, text),
  attachment_broker.begin_delete(uuid, uuid, boolean),
  public.finish_attachment_upload(uuid, uuid, text),
  public.begin_attachment_delete(uuid, uuid, boolean)
from public, anon, authenticated, service_role;
grant execute on function
  attachment_broker.finish_upload(uuid, uuid, text),
  attachment_broker.begin_delete(uuid, uuid, boolean),
  public.finish_attachment_upload(uuid, uuid, text),
  public.begin_attachment_delete(uuid, uuid, boolean)
to service_role;

-- Discarding a reservation never takes the place of provider deletion.
create or replace function public.complete_pending_attachment_delete(reservation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid;
  deleted_key text;
begin
  delete from public.attachment_reservations as r
    where r.id = reservation_id and r.state = 'deleting'
      and r.delete_requested_at <= pg_catalog.now()
      and not exists (
        select 1 from storage.objects as o
        where o.bucket_id = 'notes-attachments' and o.name = r.object_key
      )
    returning r.user_id, r.object_key into owner_id, deleted_key;
  if owner_id is not null then
    insert into attachment_broker.deleted_scan_targets (reservation_id, object_key_digest)
      values (reservation_id, pg_catalog.sha256(pg_catalog.convert_to(deleted_key, 'UTF8')))
      on conflict do nothing;
    insert into public.storage_audit(user_id, reservation_id, event)
      values (owner_id, reservation_id, 'deleted');
  end if;
end;
$$;

create or replace function public.list_pending_attachment_deletions()
returns table(id uuid, object_key text)
language sql volatile security definer set search_path = '' as $$
  with stale as (
    select r.id from public.attachment_reservations as r
    where r.state = 'reserved' and r.created_at < pg_catalog.now() - interval '15 minutes'
    order by r.created_at
    limit 1000 for update skip locked
  ), claimed as (
    update public.attachment_reservations as r
      set state = 'deleting', delete_requested_at = pg_catalog.now()
      from stale where r.id = stale.id
      returning r.id, r.user_id, r.object_key
  ), audited as (
    insert into public.storage_audit(user_id, reservation_id, event)
      select c.user_id, c.id, 'delete_requested' from claimed as c
  )
  select candidate.id, candidate.object_key from (
    select r.id, r.object_key, r.delete_requested_at
      from public.attachment_reservations as r
      where r.state = 'deleting' and r.delete_requested_at <= pg_catalog.now()
    union all
    select c.id, c.object_key, pg_catalog.now() from claimed as c
  ) as candidate
  order by candidate.delete_requested_at, candidate.id
  limit 1000;
$$;
revoke all on function public.list_stale_attachment_reservations()
  from public, anon, authenticated, service_role;

-- A direct reservation still uses the per-owner quota lock. Constrain the
-- caller-controlled key before it can enter any privileged reconciliation.
create or replace function public.reserve_attachment(
  reservation_id uuid, object_key text, display_name text, byte_size bigint, content_type text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  used_bytes bigint;
begin
  if owner_id is null then raise exception 'authentication required'; end if;
  if byte_size not between 1 and 1048576
    or content_type not in ('application/pdf', 'image/jpeg', 'image/png', 'text/plain') then
    raise exception 'invalid attachment';
  end if;
  if object_key !~ ('^' || owner_id::text ||
    '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9._-]{1,128}$') then
    raise exception 'invalid attachment key';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text, 0));
  if exists (select 1 from storage.objects as o where o.bucket_id = 'notes-attachments' and o.name = object_key) then
    raise exception 'attachment already exists';
  end if;
  select coalesce(sum(r.byte_size), 0) into used_bytes
    from public.attachment_reservations as r where r.user_id = owner_id;
  if used_bytes + byte_size > 10485760 then raise exception 'attachment quota exceeded'; end if;
  insert into public.attachment_reservations (id, user_id, object_key, display_name, byte_size, content_type)
    values (reservation_id, owner_id, object_key, display_name, byte_size, content_type);
  insert into public.storage_audit(user_id, reservation_id, event)
    values (owner_id, reservation_id, 'upload_reserved');
end;
$$;

-- Qualify replay rows so the scan transitions run with the default PL/pgSQL conflict policy.
create function attachment_broker.complete_scan(
  reservation_id uuid,
  target_key text,
  verdict text
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  attachment public.attachment_reservations;
begin
  if verdict is null or verdict not in ('clean', 'quarantined') then raise exception 'invalid scan verdict'; end if;
  select r.* into attachment from public.attachment_reservations as r
    where r.id = reservation_id for update;
  if not found then
    if attachment_broker.was_deleted(reservation_id, target_key) then return; end if;
    raise exception 'attachment reservation not found';
  end if;
  if attachment.object_key is distinct from target_key then
    raise exception 'attachment key does not match the reservation';
  end if;
  if attachment.state in ('clean', 'quarantined', 'deleting', 'scan_dead_letter') then return; end if;
  if attachment.state not in ('pending_scan', 'replay_requested') then
    raise exception 'attachment reservation is not pending scan';
  end if;
  update public.attachment_reservations set state = verdict where id = reservation_id;
  update public.attachment_scan_dead_letters as d set state = 'replayed', replayed_at = now()
    where d.reservation_id = complete_scan.reservation_id
      and d.state = 'replay_requested';
  insert into public.storage_audit(user_id, reservation_id, event)
    values (attachment.user_id, reservation_id,
      case verdict when 'clean' then 'scan_clean' else 'scan_quarantined' end);
end;
$$;

create or replace function public.record_attachment_scan_dead_letter(
  reservation_id uuid,
  target_key text
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  attachment public.attachment_reservations;
  existing_id uuid;
  previous_state text;
begin
  select r.* into attachment from public.attachment_reservations as r
    where r.id = reservation_id for update;
  if not found then
    if attachment_broker.was_deleted(reservation_id, target_key) then return; end if;
    raise exception 'attachment reservation not found';
  end if;
  if attachment.object_key is distinct from target_key then
    raise exception 'attachment key does not match the reservation';
  end if;
  if attachment.state in ('clean', 'quarantined', 'deleting') then return; end if;
  if attachment.state not in ('pending_scan', 'scan_dead_letter', 'replay_requested') then
    raise exception 'attachment reservation is not pending scan';
  end if;

  select d.id, d.state into existing_id, previous_state
    from public.attachment_scan_dead_letters d
    where d.reservation_id = record_attachment_scan_dead_letter.reservation_id
    for update;
  if existing_id is null then
    insert into public.attachment_scan_dead_letters
      (reservation_id, user_id, object_key)
      values (reservation_id, attachment.user_id, target_key);
    insert into public.storage_audit(user_id, reservation_id, event)
      values (attachment.user_id, reservation_id, 'scan_dead_letter');
  else
    update public.attachment_scan_dead_letters as d
      set delivery_count = delivery_count + 1,
        state = 'dead_letter',
        last_failed_at = now(),
        replay_requested_at = null,
        replayed_at = null
      where d.reservation_id = record_attachment_scan_dead_letter.reservation_id;
    if previous_state <> 'dead_letter' then
      insert into public.storage_audit(user_id, reservation_id, event)
        values (attachment.user_id, reservation_id, 'scan_dead_letter');
    end if;
  end if;
  update public.attachment_reservations set state = 'scan_dead_letter'
    where id = reservation_id and state in ('pending_scan', 'replay_requested');
end;
$$;

-- Both Worker revisions must cross a broker-era SQL boundary. An older
-- authorization or verdict cannot bless the pre-cutover bytes.
create function attachment_broker.authorize_scan(target_reservation_id uuid, target_object_key text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  attachment public.attachment_reservations;
begin
  select r.* into attachment from public.attachment_reservations as r
    where r.id = target_reservation_id;
  if not found then
    if not attachment_broker.was_deleted(target_reservation_id, target_object_key) then
      raise exception 'attachment reservation not found';
    end if;
  elsif attachment.object_key is distinct from target_object_key then
    raise exception 'attachment key does not match the reservation';
  elsif attachment.state in ('pending_scan', 'replay_requested') then
    return pg_catalog.jsonb_build_object(
      'status', 'scan',
      'object_key', attachment.object_key,
      'byte_size', attachment.byte_size,
      'content_type', attachment.content_type,
      'scan_policy', 'brokered-storage'
    );
  elsif attachment.state not in ('clean', 'quarantined', 'deleting', 'scan_dead_letter') then
    raise exception 'attachment is not authorized for scanning';
  end if;
  return pg_catalog.jsonb_build_object(
    'status', 'terminal',
    'object_key', target_object_key,
    'scan_policy', 'brokered-storage'
  );
end;
$$;

create function public.authorize_brokered_attachment_scan(target_reservation_id uuid, target_object_key text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select attachment_broker.authorize_scan(target_reservation_id, target_object_key);
$$;

create function public.complete_brokered_attachment_scan(reservation_id uuid, target_key text, verdict text)
returns void language sql security invoker set search_path = '' as $$
  select attachment_broker.complete_scan(reservation_id, target_key, verdict);
$$;

revoke all on function
  attachment_broker.authorize_scan(uuid, text),
  attachment_broker.complete_scan(uuid, text, text),
  public.authorize_brokered_attachment_scan(uuid, text),
  public.complete_brokered_attachment_scan(uuid, text, text)
from public, anon, authenticated, service_role;
grant execute on function
  attachment_broker.authorize_scan(uuid, text),
  attachment_broker.complete_scan(uuid, text, text),
  public.authorize_brokered_attachment_scan(uuid, text),
  public.complete_brokered_attachment_scan(uuid, text, text)
to service_role;
