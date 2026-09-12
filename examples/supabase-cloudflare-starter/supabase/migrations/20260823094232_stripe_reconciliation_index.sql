-- The reconciliation query scans received events older than one minute and
-- explicit replay requests. The previous partial index used the impossible
-- state "pending", so replace it in a forward-only migration.

drop index if exists public.stripe_events_processing_queue_idx;
create index stripe_events_processing_queue_idx
  on public.stripe_events (
    processing_state,
    coalesce(replay_requested_at, received_at),
    provider_event_id
  )
  where processing_state in ('received', 'replay_requested');
