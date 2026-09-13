alter table public.stripe_events
  add column processing_state text not null default 'completed'
    check (processing_state in ('received', 'processing', 'completed', 'dead_letter', 'replay_requested')),
  add column order_reference text,
  add column event_data jsonb not null default '{}'::jsonb,
  add column delivery_count integer not null default 0 check (delivery_count >= 0),
  add column last_attempt_at timestamptz,
  add column dead_lettered_at timestamptz,
  add column replay_requested_at timestamptz;

-- Keep the signed provider envelope immutable while allowing the delivery
-- state machine below to advance its operational columns.
create or replace function public.reject_payment_event_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'stripe_events provider envelope is immutable';
  end if;
  if row(
      old.provider_event_id, old.event_type, old.event_created_at, old.livemode,
      old.order_id, old.provider_object_id, old.order_reference, old.event_data,
      old.received_at
    ) is distinct from row(
      new.provider_event_id, new.event_type, new.event_created_at, new.livemode,
      new.order_id, new.provider_object_id, new.order_reference, new.event_data,
      new.received_at
    ) then
    raise exception 'stripe_events provider envelope is immutable';
  end if;
  return new;
end;
$$;

create or replace function public.receive_stripe_event(
  target_event_id text,
  event_type text,
  event_created_at bigint,
  event_livemode boolean,
  order_reference text,
  event_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_order_id uuid;
  current_state text;
begin
  if target_event_id !~ '^evt_[A-Za-z0-9_]+$' or event_created_at <= 0
    or length(event_type) not between 1 and 160
    or jsonb_typeof(event_data) <> 'object' or pg_column_size(event_data) > 4096 then
    raise exception 'invalid Stripe event envelope';
  end if;
  begin target_order_id := order_reference::uuid;
  exception when invalid_text_representation then target_order_id := null;
  end;
  if target_order_id is not null
    and not exists (select 1 from public.orders where id = target_order_id) then
    target_order_id := null;
  end if;

  insert into public.stripe_events (
    provider_event_id, event_type, event_created_at, livemode, order_id,
    order_reference, event_data, outcome, processing_state
  ) values (
    target_event_id, event_type, to_timestamp(event_created_at), event_livemode,
    target_order_id, order_reference, event_data, 'ignored', 'received'
  ) on conflict (provider_event_id) do nothing;

  select processing_state into current_state from public.stripe_events
  where stripe_events.provider_event_id = target_event_id;
  return jsonb_build_object('processing_state', current_state);
end;
$$;

revoke all on function public.receive_stripe_event(text, text, bigint, boolean, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.receive_stripe_event(text, text, bigint, boolean, text, jsonb)
  to service_role;

create or replace function public.process_stripe_event(target_event_id text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  stripe_event public.stripe_events;
  current_rank smallint;
  expected_amount bigint;
  expected_currency text;
  target_status text;
  target_rank smallint;
  result text := 'ignored';
  object_id text;
begin
  select * into stripe_event from public.stripe_events
  where stripe_events.provider_event_id = target_event_id for update;
  if not found then raise exception 'payment event not found'; end if;
  if stripe_event.processing_state = 'completed' then return 'duplicate'; end if;
  if stripe_event.processing_state in ('dead_letter', 'replay_requested') then return 'dead_letter'; end if;

  update public.stripe_events set
    processing_state = 'processing',
    delivery_count = delivery_count + 1,
    last_attempt_at = now()
  where stripe_events.provider_event_id = target_event_id;

  object_id := stripe_event.event_data ->> 'id';
  if stripe_event.order_id is not null then
    select status_rank, amount_total, currency into current_rank, expected_amount, expected_currency
    from public.orders where id = stripe_event.order_id for update;
  end if;

  case stripe_event.event_type
    when 'checkout.session.completed' then
      if stripe_event.event_data ->> 'payment_status' = 'paid'
        and jsonb_typeof(stripe_event.event_data -> 'amount_total') = 'number'
        and (stripe_event.event_data ->> 'amount_total')::bigint = expected_amount
        and stripe_event.event_data ->> 'currency' = expected_currency
      then target_status := 'paid'; target_rank := 30; end if;
    when 'checkout.session.async_payment_succeeded' then
      if jsonb_typeof(stripe_event.event_data -> 'amount_total') = 'number'
        and (stripe_event.event_data ->> 'amount_total')::bigint = expected_amount
        and stripe_event.event_data ->> 'currency' = expected_currency
      then target_status := 'paid'; target_rank := 30; end if;
    when 'checkout.session.expired' then target_status := 'expired'; target_rank := 20;
    when 'checkout.session.async_payment_failed' then target_status := 'payment_failed'; target_rank := 20;
    when 'payment_intent.payment_failed' then target_status := 'payment_failed'; target_rank := 20;
    else null;
  end case;

  if current_rank is not null and target_rank is not null then
    if target_rank > current_rank then
      update public.orders set
        status = target_status,
        status_rank = target_rank,
        stripe_checkout_session_id = case when stripe_event.event_type like 'checkout.session.%'
          then coalesce(stripe_checkout_session_id, object_id) else stripe_checkout_session_id end,
        stripe_payment_intent_id = coalesce(stripe_payment_intent_id,
          case when stripe_event.event_type like 'payment_intent.%' then object_id
            else stripe_event.event_data ->> 'payment_intent' end),
        updated_at = now()
      where id = stripe_event.order_id;
      result := 'applied';
    else result := 'stale';
    end if;
  end if;

  update public.stripe_events set processing_state = 'completed', outcome = result
  where stripe_events.provider_event_id = target_event_id;
  return result;
end;
$$;

revoke all on function public.process_stripe_event(text) from public, anon, authenticated;
grant execute on function public.process_stripe_event(text) to service_role;

create or replace function public.record_payment_event_dead_letter(target_event_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.stripe_events set
    processing_state = 'dead_letter',
    delivery_count = delivery_count + 1,
    dead_lettered_at = coalesce(dead_lettered_at, now()),
    replay_requested_at = null
  where stripe_events.provider_event_id = target_event_id
    and processing_state <> 'completed';
  if not found then raise exception 'payment event unavailable for dead-letter'; end if;
end;
$$;

create or replace function public.list_pending_payment_events()
returns table (provider_event_id text, processing_state text)
language sql security definer set search_path = '' as $$
  select e.provider_event_id, e.processing_state from public.stripe_events e
  where (e.processing_state = 'received' and e.received_at < now() - interval '1 minute')
     or e.processing_state = 'replay_requested'
  order by coalesce(e.replay_requested_at, e.received_at) limit 100;
$$;

create or replace function public.mark_payment_event_replay_enqueued(target_event_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.stripe_events set processing_state = 'received'
  where stripe_events.provider_event_id = target_event_id
    and processing_state = 'replay_requested';
  if not found then raise exception 'payment replay request unavailable'; end if;
end;
$$;

revoke all on function public.record_payment_event_dead_letter(text) from public, anon, authenticated;
revoke all on function public.list_pending_payment_events() from public, anon, authenticated;
revoke all on function public.mark_payment_event_replay_enqueued(text) from public, anon, authenticated;
grant execute on function public.record_payment_event_dead_letter(text) to service_role;
grant execute on function public.list_pending_payment_events() to service_role;
grant execute on function public.mark_payment_event_replay_enqueued(text) to service_role;

create or replace function public.list_payment_event_dead_letters()
returns table (
  provider_event_id text, event_type text, delivery_count integer,
  dead_lettered_at timestamptz, processing_state text
)
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'admin required';
  end if;
  return query select e.provider_event_id, e.event_type, e.delivery_count,
    e.dead_lettered_at, e.processing_state
  from public.stripe_events e
  where e.processing_state in ('dead_letter', 'replay_requested')
  order by e.dead_lettered_at desc limit 100;
end;
$$;

create or replace function public.request_payment_event_replay(target_event_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'admin required';
  end if;
  update public.stripe_events set processing_state = 'replay_requested', replay_requested_at = now()
  where stripe_events.provider_event_id = target_event_id
    and processing_state = 'dead_letter';
  if not found then raise exception 'payment dead-letter unavailable'; end if;
end;
$$;

revoke all on function public.list_payment_event_dead_letters() from public, anon;
revoke all on function public.request_payment_event_replay(text) from public, anon;
grant execute on function public.list_payment_event_dead_letters() to authenticated;
grant execute on function public.request_payment_event_replay(text) to authenticated;

-- The Queue-backed receive/process pair is now the only runtime ingestion path.
drop function public.ingest_stripe_event(text, text, bigint, boolean, text, jsonb);
