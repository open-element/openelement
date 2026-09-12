-- Durable dead-letter capture and explicit admin-requested attachment replay.
-- The primary reconciliation query deliberately ignores scan_dead_letter and
-- replay_requested rows: a poison message must not become an automatic loop.

alter table public.attachment_reservations
  drop constraint attachment_reservations_state_check;
alter table public.attachment_reservations
  add constraint attachment_reservations_state_check
  check (state in (
    'reserved', 'pending_scan', 'scan_dead_letter', 'replay_requested',
    'clean', 'quarantined'
  ));

alter table public.storage_audit
  drop constraint storage_audit_event_check;
alter table public.storage_audit
  add constraint storage_audit_event_check
  check (event in (
    'upload_reserved', 'upload_pending_scan', 'upload_failed', 'deleted',
    'scan_clean', 'scan_quarantined', 'scan_dead_letter',
    'scan_replay_requested', 'scan_replayed', 'stale_released'
  ));

create table public.attachment_scan_dead_letters (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null unique
    references public.attachment_reservations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  object_key text not null,
  state text not null default 'dead_letter'
    check (state in ('dead_letter', 'replay_requested', 'replayed')),
  delivery_count integer not null default 1 check (delivery_count > 0),
  first_failed_at timestamptz not null default now(),
  last_failed_at timestamptz not null default now(),
  replay_requested_at timestamptz,
  replayed_at timestamptz
);

alter table public.attachment_scan_dead_letters enable row level security;

create or replace function public.record_attachment_scan_dead_letter(
  reservation_id uuid,
  target_key text
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  owner_id uuid;
  existing_id uuid;
  previous_state text;
begin
  select r.user_id into owner_id
    from public.attachment_reservations r
    where r.id = reservation_id
      and r.object_key = target_key
      and r.state in ('pending_scan', 'scan_dead_letter', 'replay_requested')
    for update;
  if owner_id is null then raise exception 'pending attachment reservation not found'; end if;

  select d.id, d.state into existing_id, previous_state
    from public.attachment_scan_dead_letters d
    where d.reservation_id = record_attachment_scan_dead_letter.reservation_id
    for update;
  if existing_id is null then
    insert into public.attachment_scan_dead_letters
      (reservation_id, user_id, object_key)
      values (reservation_id, owner_id, target_key);
    insert into public.storage_audit(user_id, reservation_id, event)
      values (owner_id, reservation_id, 'scan_dead_letter');
  else
    update public.attachment_scan_dead_letters
      set delivery_count = delivery_count + 1,
        state = 'dead_letter',
        last_failed_at = now(),
        replay_requested_at = null,
        replayed_at = null
      where reservation_id = record_attachment_scan_dead_letter.reservation_id;
    if previous_state <> 'dead_letter' then
      insert into public.storage_audit(user_id, reservation_id, event)
        values (owner_id, reservation_id, 'scan_dead_letter');
    end if;
  end if;
  update public.attachment_reservations set state = 'scan_dead_letter'
    where id = reservation_id and state in ('pending_scan', 'replay_requested');
end;
$$;

create or replace function public.list_attachment_scan_dead_letters()
returns table(
  id uuid,
  object_key text,
  state text,
  delivery_count integer,
  first_failed_at timestamptz,
  replay_requested_at timestamptz,
  replayed_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'admin role required';
  end if;
  return query
    select d.id, d.object_key, d.state, d.delivery_count,
      d.first_failed_at, d.replay_requested_at, d.replayed_at
    from public.attachment_scan_dead_letters d
    order by d.first_failed_at desc limit 100;
end;
$$;

create or replace function public.request_attachment_scan_replay(
  dead_letter_id uuid
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  owner_id uuid;
  target_reservation uuid;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'admin role required';
  end if;
  update public.attachment_scan_dead_letters
    set state = 'replay_requested', replay_requested_at = now(), replayed_at = null
    where id = dead_letter_id and state = 'dead_letter'
    returning user_id, reservation_id into owner_id, target_reservation;
  if owner_id is null then raise exception 'dead letter is not replayable'; end if;
  update public.attachment_reservations set state = 'replay_requested'
    where id = target_reservation and state = 'scan_dead_letter';
  if not found then raise exception 'attachment is not dead-lettered'; end if;
  insert into public.storage_audit(user_id, reservation_id, event)
    values (owner_id, target_reservation, 'scan_replay_requested');
end;
$$;

create or replace function public.list_requested_attachment_scan_replays()
returns table(id uuid, reservation_id uuid, object_key text)
language sql stable security definer set search_path = ''
as $$
  select d.id, d.reservation_id, d.object_key
  from public.attachment_scan_dead_letters d
  join public.attachment_reservations r on r.id = d.reservation_id
  where d.state = 'replay_requested' and r.state = 'replay_requested'
  order by d.replay_requested_at limit 100;
$$;

create or replace function public.mark_attachment_scan_replayed(
  dead_letter_id uuid
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  owner_id uuid;
  target_reservation uuid;
begin
  update public.attachment_scan_dead_letters
    set state = 'replayed', replayed_at = now()
    where id = dead_letter_id and state = 'replay_requested'
    returning user_id, reservation_id into owner_id, target_reservation;
  if owner_id is null then return; end if;
  update public.attachment_reservations set state = 'pending_scan'
    where id = target_reservation and state = 'replay_requested';
  insert into public.storage_audit(user_id, reservation_id, event)
    values (owner_id, target_reservation, 'scan_replayed');
end;
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
  if current_state not in ('pending_scan', 'replay_requested') then
    raise exception 'attachment reservation is not pending scan';
  end if;
  update public.attachment_reservations set state = verdict
    where id = reservation_id and state in ('pending_scan', 'replay_requested')
    returning user_id into owner_id;
  if owner_id is null then raise exception 'attachment reservation not found'; end if;
  update public.attachment_scan_dead_letters set state = 'replayed', replayed_at = now()
    where reservation_id = complete_attachment_scan.reservation_id
      and state = 'replay_requested';
  insert into public.storage_audit(user_id, reservation_id, event)
    values (owner_id, reservation_id,
      case verdict when 'clean' then 'scan_clean' else 'scan_quarantined' end);
end;
$$;

revoke all on table public.attachment_scan_dead_letters from public;
revoke all on function public.record_attachment_scan_dead_letter(uuid, text) from public;
revoke all on function public.list_attachment_scan_dead_letters() from public;
revoke all on function public.request_attachment_scan_replay(uuid) from public;
revoke all on function public.list_requested_attachment_scan_replays() from public;
revoke all on function public.mark_attachment_scan_replayed(uuid) from public;
revoke all on function public.complete_attachment_scan(uuid, text, text) from public;
grant execute on function public.record_attachment_scan_dead_letter(uuid, text) to service_role;
grant execute on function public.list_attachment_scan_dead_letters() to authenticated;
grant execute on function public.request_attachment_scan_replay(uuid) to authenticated;
grant execute on function public.list_requested_attachment_scan_replays() to service_role;
grant execute on function public.mark_attachment_scan_replayed(uuid) to service_role;
grant execute on function public.complete_attachment_scan(uuid, text, text) to service_role;
