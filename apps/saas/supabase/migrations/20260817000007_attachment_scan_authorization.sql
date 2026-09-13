create or replace function public.authorize_attachment_scan(
  target_reservation_id uuid,
  target_object_key text
)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare attachment public.attachment_reservations;
begin
  select r.* into attachment
  from public.attachment_reservations r
  where r.id = target_reservation_id
    and r.object_key = target_object_key
    and r.state in ('pending_scan', 'replay_requested')
  limit 1;
  if not found then raise exception 'attachment is not authorized for scanning'; end if;
  return jsonb_build_object(
    'object_key', attachment.object_key,
    'byte_size', attachment.byte_size,
    'content_type', attachment.content_type
  );
end;
$$;

revoke all on function public.authorize_attachment_scan(uuid, text)
  from public, anon, authenticated;
grant execute on function public.authorize_attachment_scan(uuid, text) to service_role;
