-- Storage and Postgres cannot share a transaction. Persist deletion intent
-- before touching Storage; both the request path and Cron can then converge an
-- interrupted delete without permanently consuming quota.

alter table public.attachment_reservations
  drop constraint attachment_reservations_state_check;
alter table public.attachment_reservations
  add constraint attachment_reservations_state_check
  check (state in (
    'reserved', 'pending_scan', 'scan_dead_letter', 'replay_requested',
    'clean', 'quarantined', 'deleting'
  ));
alter table public.attachment_reservations
  add column delete_requested_at timestamptz;

alter table public.storage_audit
  drop constraint storage_audit_event_check;
alter table public.storage_audit
  add constraint storage_audit_event_check
  check (event in (
    'upload_reserved', 'upload_pending_scan', 'upload_failed',
    'delete_requested', 'deleted', 'scan_clean', 'scan_quarantined',
    'scan_dead_letter', 'scan_replay_requested', 'scan_replayed',
    'stale_released'
  ));

create index attachment_reservations_deleting_idx
  on public.attachment_reservations (delete_requested_at, id)
  where state = 'deleting';

create or replace function public.request_attachment_delete(target_key text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := (select auth.uid());
  target_reservation uuid;
begin
  if owner_id is null then raise exception 'authentication required'; end if;
  update public.attachment_reservations
    set state = 'deleting', delete_requested_at = coalesce(delete_requested_at, now())
    where object_key = target_key and user_id = owner_id
    returning id into target_reservation;
  if target_reservation is not null then
    insert into public.storage_audit(user_id, reservation_id, event)
      values (owner_id, target_reservation, 'delete_requested');
  end if;
end;
$$;

create or replace function public.complete_attachment_delete(target_key text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := (select auth.uid());
  target_reservation uuid;
begin
  if owner_id is null then raise exception 'authentication required'; end if;
  delete from public.attachment_reservations
    where object_key = target_key and user_id = owner_id and state = 'deleting'
    returning id into target_reservation;
  if target_reservation is not null then
    insert into public.storage_audit(user_id, reservation_id, event)
      values (owner_id, target_reservation, 'deleted');
  end if;
end;
$$;

create or replace function public.list_pending_attachment_deletions()
returns table(id uuid, object_key text)
language sql stable security definer set search_path = '' as $$
  select r.id, r.object_key
  from public.attachment_reservations r
  where r.state = 'deleting'
  order by r.delete_requested_at, r.id
  limit 1000;
$$;

create or replace function public.complete_pending_attachment_delete(reservation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid;
begin
  delete from public.attachment_reservations
    where id = reservation_id and state = 'deleting'
    returning user_id into owner_id;
  if owner_id is not null then
    insert into public.storage_audit(user_id, reservation_id, event)
      values (owner_id, reservation_id, 'deleted');
  end if;
end;
$$;

revoke all on function public.request_attachment_delete(text) from public, anon, service_role;
revoke all on function public.complete_attachment_delete(text) from public, anon, service_role;
revoke all on function public.list_pending_attachment_deletions()
  from public, anon, authenticated;
revoke all on function public.complete_pending_attachment_delete(uuid)
  from public, anon, authenticated;
grant execute on function public.request_attachment_delete(text) to authenticated;
grant execute on function public.complete_attachment_delete(text) to authenticated;
grant execute on function public.list_pending_attachment_deletions() to service_role;
grant execute on function public.complete_pending_attachment_delete(uuid) to service_role;
