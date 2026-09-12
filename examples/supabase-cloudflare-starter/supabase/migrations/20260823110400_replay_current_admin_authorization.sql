-- Access tokens cache app_metadata until refresh. Replay requests are a
-- privileged state transition, so authorize the actor against the current
-- server-owned auth.users metadata instead of trusting a possibly stale JWT
-- role claim. auth.uid() remains the verified actor identity and audit source.

create or replace function public.request_payment_event_replay(target_event_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  audit_actor uuid := (select auth.uid());
begin
  if audit_actor is null
    or coalesce((
      select u.raw_app_meta_data ->> 'role'
      from auth.users u
      where u.id = audit_actor
    ), '') <> 'admin'
  then
    raise exception 'admin required';
  end if;

  update public.stripe_events set
    processing_state = 'replay_requested',
    replay_requested_at = now(),
    replay_requested_by = audit_actor
  where stripe_events.provider_event_id = target_event_id
    and processing_state = 'dead_letter';
  if not found then raise exception 'payment dead-letter unavailable'; end if;

  insert into public.admin_audit (actor_id, action, target_type, target_id)
    values (audit_actor, 'payment_event_replay_requested', 'payment_event', target_event_id);
end;
$$;

create or replace function public.request_attachment_scan_replay(dead_letter_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  audit_actor uuid := (select auth.uid());
  owner_id uuid;
  target_reservation uuid;
begin
  if audit_actor is null
    or coalesce((
      select u.raw_app_meta_data ->> 'role'
      from auth.users u
      where u.id = audit_actor
    ), '') <> 'admin'
  then
    raise exception 'admin role required';
  end if;

  update public.attachment_scan_dead_letters
    set state = 'replay_requested',
      replay_requested_at = now(),
      replayed_at = null,
      replay_requested_by = audit_actor
    where id = dead_letter_id and state = 'dead_letter'
    returning user_id, reservation_id into owner_id, target_reservation;
  if owner_id is null then raise exception 'dead letter is not replayable'; end if;

  update public.attachment_reservations set state = 'replay_requested'
    where id = target_reservation and state = 'scan_dead_letter';
  if not found then raise exception 'attachment is not dead-lettered'; end if;

  insert into public.storage_audit(user_id, reservation_id, event)
    values (owner_id, target_reservation, 'scan_replay_requested');
  insert into public.admin_audit (actor_id, action, target_type, target_id)
    values (
      audit_actor,
      'attachment_scan_replay_requested',
      'attachment_scan_dead_letter',
      dead_letter_id::text
    );
end;
$$;

revoke all on function public.request_payment_event_replay(text)
  from public, anon, service_role;
revoke all on function public.request_attachment_scan_replay(uuid)
  from public, anon, service_role;
grant execute on function public.request_payment_event_replay(text) to authenticated;
grant execute on function public.request_attachment_scan_replay(uuid) to authenticated;
