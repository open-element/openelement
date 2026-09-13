-- Forward-only scan state, audit, and service-role maintenance functions.

alter table public.attachment_reservations
  drop constraint attachment_reservations_state_check;
alter table public.attachment_reservations
  add constraint attachment_reservations_state_check
  check (state in ('reserved', 'pending_scan', 'clean', 'quarantined'));
update public.attachment_reservations set state = 'clean' where state = 'ready';

create table public.storage_audit (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  reservation_id uuid,
  event text not null check (event in (
    'upload_reserved', 'upload_pending_scan', 'upload_failed', 'deleted',
    'scan_clean', 'scan_quarantined', 'stale_released'
  )),
  created_at timestamptz not null default now()
);
alter table public.storage_audit enable row level security;
create policy "storage audit: owner reads"
  on public.storage_audit for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.reserve_attachment(
  reservation_id uuid,
  object_key text,
  display_name text,
  byte_size bigint,
  content_type text
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  used_bytes bigint;
begin
  if owner_id is null then raise exception 'authentication required'; end if;
  if byte_size <= 0 then raise exception 'invalid attachment size'; end if;
  if object_key not like owner_id::text || '/%' then raise exception 'invalid owner prefix'; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text, 0));
  select coalesce(sum(r.byte_size), 0) into used_bytes
    from public.attachment_reservations r where r.user_id = owner_id;
  if used_bytes + byte_size > 10485760 then raise exception 'attachment quota exceeded'; end if;
  insert into public.attachment_reservations
    (id, user_id, object_key, display_name, byte_size, content_type)
    values (reservation_id, owner_id, object_key, display_name, byte_size, content_type);
  insert into public.storage_audit(user_id, reservation_id, event)
    values (owner_id, reservation_id, 'upload_reserved');
end;
$$;

create or replace function public.finalize_attachment(reservation_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare owner_id uuid;
begin
  update public.attachment_reservations set state = 'pending_scan'
    where id = reservation_id and user_id = auth.uid() and state = 'reserved'
    returning user_id into owner_id;
  if owner_id is null then raise exception 'attachment reservation not found'; end if;
  insert into public.storage_audit(user_id, reservation_id, event)
    values (owner_id, reservation_id, 'upload_pending_scan');
end;
$$;

create or replace function public.release_attachment(reservation_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare owner_id uuid;
begin
  delete from public.attachment_reservations
    where id = reservation_id and user_id = auth.uid()
    returning user_id into owner_id;
  if owner_id is not null then
    insert into public.storage_audit(user_id, reservation_id, event)
      values (owner_id, reservation_id, 'upload_failed');
  end if;
end;
$$;

create or replace function public.release_attachment_by_key(target_key text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  owner_id uuid;
  released_id uuid;
begin
  delete from public.attachment_reservations
    where object_key = target_key and user_id = auth.uid()
    returning id, user_id into released_id, owner_id;
  if owner_id is not null then
    insert into public.storage_audit(user_id, reservation_id, event)
      values (owner_id, released_id, 'deleted');
  end if;
end;
$$;

create or replace function public.list_downloadable_attachments()
returns table(object_key text, display_name text)
language sql stable security invoker set search_path = ''
as $$
  select r.object_key, r.display_name
  from public.attachment_reservations r
  where r.user_id = auth.uid() and r.state = 'clean'
  order by r.created_at desc limit 100;
$$;

create or replace function public.list_stale_attachment_reservations()
returns table(id uuid, user_id uuid, object_key text)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.user_id, r.object_key
  from public.attachment_reservations r
  where r.state = 'reserved' and r.created_at < now() - interval '15 minutes'
  order by r.created_at limit 1000;
$$;

create or replace function public.list_pending_attachment_scans()
returns table(id uuid, object_key text)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.object_key
  from public.attachment_reservations r
  where r.state = 'pending_scan' and r.created_at < now() - interval '5 minutes'
  order by r.created_at limit 1000;
$$;

create or replace function public.complete_attachment_scan(
  reservation_id uuid,
  target_key text,
  verdict text
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  owner_id uuid;
  current_state text;
begin
  if verdict not in ('clean', 'quarantined') then raise exception 'invalid scan verdict'; end if;
  select r.state, r.user_id into current_state, owner_id
    from public.attachment_reservations r
    where r.id = reservation_id and r.object_key = target_key for update;
  if current_state = verdict then return; end if;
  if current_state is distinct from 'pending_scan' then
    raise exception 'attachment reservation is not pending scan';
  end if;
  update public.attachment_reservations
    set state = verdict
    where id = reservation_id and state = 'pending_scan'
    returning user_id into owner_id;
  if owner_id is null then raise exception 'attachment reservation not found'; end if;
  insert into public.storage_audit(user_id, reservation_id, event)
    values (owner_id, reservation_id,
      case verdict when 'clean' then 'scan_clean' else 'scan_quarantined' end);
end;
$$;

create or replace function public.release_stale_attachment(reservation_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare owner_id uuid;
begin
  delete from public.attachment_reservations
    where id = reservation_id and state = 'reserved'
    returning user_id into owner_id;
  if owner_id is not null then
    insert into public.storage_audit(user_id, reservation_id, event)
      values (owner_id, reservation_id, 'stale_released');
  end if;
end;
$$;

revoke all on function public.list_downloadable_attachments() from public;
revoke all on function public.list_stale_attachment_reservations() from public;
revoke all on function public.list_pending_attachment_scans() from public;
revoke all on function public.complete_attachment_scan(uuid, text, text) from public;
revoke all on function public.release_stale_attachment(uuid) from public;
grant execute on function public.list_downloadable_attachments() to authenticated;
grant execute on function public.list_stale_attachment_reservations() to service_role;
grant execute on function public.list_pending_attachment_scans() to service_role;
grant execute on function public.complete_attachment_scan(uuid, text, text) to service_role;
grant execute on function public.release_stale_attachment(uuid) to service_role;
