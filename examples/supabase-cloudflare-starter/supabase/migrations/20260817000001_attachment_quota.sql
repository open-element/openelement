-- Atomic attachment quota reservations for the private notes-attachments bucket.
-- Storage writes are not transactional with Postgres, so callers reserve first,
-- upload second, then finalize; every failure path releases the reservation.

create table public.attachment_reservations (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  object_key text not null unique,
  display_name text not null,
  byte_size bigint not null check (byte_size > 0),
  content_type text not null,
  state text not null default 'reserved' check (state in ('reserved', 'ready')),
  created_at timestamptz not null default now()
);

alter table public.attachment_reservations enable row level security;

create policy "attachment reservations: owner reads"
  on public.attachment_reservations for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.reserve_attachment(
  reservation_id uuid,
  object_key text,
  display_name text,
  byte_size bigint,
  content_type text
) returns void
language plpgsql security definer
set search_path = ''
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
end;
$$;

create or replace function public.finalize_attachment(reservation_id uuid)
returns void language sql security definer set search_path = ''
as $$
  update public.attachment_reservations set state = 'ready'
  where id = reservation_id and user_id = auth.uid() and state = 'reserved';
$$;

create or replace function public.release_attachment(reservation_id uuid)
returns void language sql security definer set search_path = ''
as $$
  delete from public.attachment_reservations
  where id = reservation_id and user_id = auth.uid();
$$;

create or replace function public.release_attachment_by_key(target_key text)
returns void language sql security definer set search_path = ''
as $$
  delete from public.attachment_reservations
  where object_key = target_key and user_id = auth.uid();
$$;

revoke all on function public.reserve_attachment(uuid, text, text, bigint, text) from public;
revoke all on function public.finalize_attachment(uuid) from public;
revoke all on function public.release_attachment(uuid) from public;
revoke all on function public.release_attachment_by_key(text) from public;
grant execute on function public.reserve_attachment(uuid, text, text, bigint, text) to authenticated;
grant execute on function public.finalize_attachment(uuid) to authenticated;
grant execute on function public.release_attachment(uuid) to authenticated;
grant execute on function public.release_attachment_by_key(text) to authenticated;
