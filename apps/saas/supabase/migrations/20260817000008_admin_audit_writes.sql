-- admin_audit write path (#998): the table and its immutable trigger landed in
-- 20260817000000_admin_audit.sql but nothing wrote to it yet. Two channels
-- match the existing RLS design:
--   1. authenticated admins insert directly — the "admin audit: admins append"
--      policy pins actor_id = auth.uid() (used by app/routes/admin.tsx);
--   2. the service-role lifecycle worker goes through the security-definer
--      log_admin_audit below, the same rpc-only convention as every other
--      worker write. To keep the handoff row's actor truthful, the requesting
--      admin's id is threaded through replay_requested_by at request time.

alter table public.stripe_events
  add column replay_requested_by uuid references auth.users(id);

alter table public.attachment_scan_dead_letters
  add column replay_requested_by uuid references auth.users(id);

-- Same bodies as 20260817000006_payment_queue.sql /
-- 20260817000003_attachment_scan_replay.sql plus capturing the requesting
-- admin. Signatures are unchanged, so existing grants carry over.
create or replace function public.request_payment_event_replay(target_event_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'admin required';
  end if;
  update public.stripe_events set
    processing_state = 'replay_requested',
    replay_requested_at = now(),
    replay_requested_by = (select auth.uid())
  where stripe_events.provider_event_id = target_event_id
    and processing_state = 'dead_letter';
  if not found then raise exception 'payment dead-letter unavailable'; end if;
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
    set state = 'replay_requested',
      replay_requested_at = now(),
      replayed_at = null,
      replay_requested_by = (select auth.uid())
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

-- The return type gains replay_requested_by, so replace-by-drop is required.
drop function public.list_pending_payment_events();
create function public.list_pending_payment_events()
returns table (provider_event_id text, processing_state text, replay_requested_by uuid)
language sql security definer set search_path = '' as $$
  select e.provider_event_id, e.processing_state, e.replay_requested_by
  from public.stripe_events e
  where (e.processing_state = 'received' and e.received_at < now() - interval '1 minute')
     or e.processing_state = 'replay_requested'
  order by coalesce(e.replay_requested_at, e.received_at) limit 100;
$$;
revoke all on function public.list_pending_payment_events() from public, anon, authenticated;
grant execute on function public.list_pending_payment_events() to service_role;

drop function public.list_requested_attachment_scan_replays();
create function public.list_requested_attachment_scan_replays()
returns table(id uuid, reservation_id uuid, object_key text, replay_requested_by uuid)
language sql stable security definer set search_path = ''
as $$
  select d.id, d.reservation_id, d.object_key, d.replay_requested_by
  from public.attachment_scan_dead_letters d
  join public.attachment_reservations r on r.id = d.reservation_id
  where d.state = 'replay_requested' and r.state = 'replay_requested'
  order by d.replay_requested_at limit 100;
$$;
revoke all on function public.list_requested_attachment_scan_replays() from public;
revoke all on function public.list_requested_attachment_scan_replays() from anon, authenticated;
grant execute on function public.list_requested_attachment_scan_replays() to service_role;

-- Worker-side append channel. Security definer with an explicit actor, so it
-- must never reach authenticated: the whole point of the RLS policy is that
-- user-JWT callers can only speak for themselves. No PII, no secrets — ids
-- and snake_case verbs only.
create or replace function public.log_admin_audit(
  actor uuid,
  action text,
  target_type text,
  target_id text
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if actor is null
    or action !~ '^[a-z][a-z0-9_]{2,63}$'
    or target_type !~ '^[a-z][a-z0-9_]{2,63}$'
    or length(coalesce(target_id, '')) > 256 then
    raise exception 'invalid admin audit envelope';
  end if;
  insert into public.admin_audit (actor_id, action, target_type, target_id)
    values (actor, action, target_type, target_id);
end;
$$;

revoke all on function public.log_admin_audit(uuid, text, text, text) from public;
revoke all on function public.log_admin_audit(uuid, text, text, text) from anon, authenticated;
grant execute on function public.log_admin_audit(uuid, text, text, text) to service_role;
