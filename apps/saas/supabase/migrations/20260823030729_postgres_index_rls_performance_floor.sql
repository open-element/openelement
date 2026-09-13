-- Forward-only Postgres performance floor (#1113).
-- Equality/RLS/FK columns lead each composite index; range/order keys follow.

create index if not exists notes_owner_created_id_idx
  on public.notes (user_id, created_at desc, id desc);

create index if not exists admin_audit_actor_created_id_idx
  on public.admin_audit (actor_id, created_at desc, id desc);

create index if not exists attachment_reservations_owner_state_created_id_idx
  on public.attachment_reservations (user_id, state, created_at desc, id);

create index if not exists attachment_scan_dead_letters_owner_failed_id_idx
  on public.attachment_scan_dead_letters (user_id, first_failed_at desc, id);
create index if not exists attachment_scan_dead_letters_replay_actor_idx
  on public.attachment_scan_dead_letters (replay_requested_by)
  where replay_requested_by is not null;
create index if not exists attachment_scan_dead_letters_replay_queue_idx
  on public.attachment_scan_dead_letters (state, replay_requested_at, id)
  where state = 'replay_requested';

create index if not exists storage_audit_owner_created_id_idx
  on public.storage_audit (user_id, created_at desc, id desc);

create index if not exists orders_owner_created_id_idx
  on public.orders (user_id, created_at desc, id desc);
create index if not exists orders_product_code_idx
  on public.orders (product_code);

create index if not exists stripe_events_order_created_id_idx
  on public.stripe_events (order_id, event_created_at desc, provider_event_id)
  where order_id is not null;
create index if not exists stripe_events_replay_actor_idx
  on public.stripe_events (replay_requested_by)
  where replay_requested_by is not null;
create index if not exists stripe_events_processing_queue_idx
  on public.stripe_events (
    processing_state,
    coalesce(replay_requested_at, received_at),
    provider_event_id
  )
  where processing_state in ('pending', 'replay_requested');

-- Replace the original notes policies rather than mutating applied history.
-- The owner/admin read branches are combined to avoid duplicate permissive
-- policy evaluation. UPDATE keeps both old-row visibility and new-row checks.
drop policy if exists "notes: owner reads own rows" on public.notes;
drop policy if exists "notes: admins read all rows" on public.notes;
drop policy if exists "notes: owner inserts own rows" on public.notes;
drop policy if exists "notes: owner updates own rows" on public.notes;
drop policy if exists "notes: owner deletes own rows" on public.notes;

create policy "notes: owners or admins read rows"
  on public.notes for select to authenticated
  using (
    (select auth.uid()) = user_id
    or coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin'
  );

create policy "notes: owner inserts own rows"
  on public.notes for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "notes: owner updates own rows"
  on public.notes for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "notes: owner deletes own rows"
  on public.notes for delete to authenticated
  using ((select auth.uid()) = user_id);
