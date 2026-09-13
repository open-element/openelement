-- Replay state and the required admin handoff audit must commit or roll back
-- together. The queue send remains outside Postgres, so workers call these
-- functions only after Cloudflare has accepted the message.

create or replace function public.mark_attachment_scan_replayed(
  dead_letter_id uuid
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  owner_id uuid;
  target_reservation uuid;
  audit_actor uuid;
begin
  update public.attachment_scan_dead_letters
    set state = 'replayed', replayed_at = now()
    where id = dead_letter_id and state = 'replay_requested'
    returning user_id, reservation_id, replay_requested_by
      into owner_id, target_reservation, audit_actor;
  if owner_id is null then return; end if;

  update public.attachment_reservations set state = 'pending_scan'
    where id = target_reservation and state = 'replay_requested';
  if not found then raise exception 'attachment replay reservation unavailable'; end if;

  insert into public.storage_audit(user_id, reservation_id, event)
    values (owner_id, target_reservation, 'scan_replayed');
  if audit_actor is not null then
    insert into public.admin_audit(actor_id, action, target_type, target_id)
      values (
        audit_actor,
        'attachment_scan_replay_enqueued',
        'attachment_scan_dead_letter',
        dead_letter_id::text
      );
  end if;
end;
$$;

create or replace function public.mark_payment_event_replay_enqueued(target_event_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  audit_actor uuid;
begin
  update public.stripe_events set processing_state = 'received'
  where stripe_events.provider_event_id = target_event_id
    and processing_state = 'replay_requested'
  returning replay_requested_by into audit_actor;
  if not found then raise exception 'payment replay request unavailable'; end if;

  if audit_actor is not null then
    insert into public.admin_audit(actor_id, action, target_type, target_id)
      values (audit_actor, 'payment_event_replay_enqueued', 'payment_event', target_event_id);
  end if;
end;
$$;

revoke all on function public.mark_attachment_scan_replayed(uuid) from public, anon, authenticated;
revoke all on function public.mark_payment_event_replay_enqueued(text) from public, anon, authenticated;
grant execute on function public.mark_attachment_scan_replayed(uuid) to service_role;
grant execute on function public.mark_payment_event_replay_enqueued(text) to service_role;
