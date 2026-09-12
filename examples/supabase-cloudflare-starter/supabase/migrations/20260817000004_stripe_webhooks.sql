create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  status text not null default 'created'
    check (status in ('created', 'checkout_open', 'payment_failed', 'expired', 'paid', 'refunded')),
  status_rank smallint not null default 0 check (status_rank between 0 and 40),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  amount_total bigint not null check (amount_total > 0),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.stripe_events (
  provider_event_id text primary key,
  event_type text not null,
  event_created_at timestamptz not null,
  livemode boolean not null,
  order_id uuid references public.orders(id),
  provider_object_id text,
  outcome text not null check (outcome in ('applied', 'ignored', 'stale')),
  received_at timestamptz not null default now()
);

alter table public.orders enable row level security;
alter table public.stripe_events enable row level security;

create policy "orders: owners read" on public.orders for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.reject_payment_event_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'stripe_events records are immutable';
end;
$$;

create trigger stripe_events_immutable before update or delete on public.stripe_events
for each row execute function public.reject_payment_event_mutation();

create or replace function public.ingest_stripe_event(
  provider_event_id text,
  event_type text,
  event_created_at bigint,
  event_livemode boolean,
  order_reference text,
  provider_object jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_order_id uuid;
  target_status text;
  target_rank smallint;
  current_rank smallint;
  result text := 'ignored';
  object_id text := provider_object ->> 'id';
begin
  if provider_event_id !~ '^evt_[A-Za-z0-9_]+$' or event_created_at <= 0 then
    raise exception 'invalid Stripe event identity';
  end if;

  begin
    target_order_id := order_reference::uuid;
  exception when invalid_text_representation then
    target_order_id := null;
  end;

  if target_order_id is not null then
    select status_rank into current_rank from public.orders where id = target_order_id for update;
  end if;

  case event_type
    when 'checkout.session.completed' then
      if provider_object ->> 'payment_status' = 'paid' then target_status := 'paid'; target_rank := 30; end if;
    when 'checkout.session.async_payment_succeeded' then target_status := 'paid'; target_rank := 30;
    when 'checkout.session.expired' then target_status := 'expired'; target_rank := 20;
    when 'checkout.session.async_payment_failed' then target_status := 'payment_failed'; target_rank := 20;
    when 'payment_intent.payment_failed' then target_status := 'payment_failed'; target_rank := 20;
    when 'charge.refunded' then target_status := 'refunded'; target_rank := 40;
    else null;
  end case;

  if current_rank is not null and target_rank is not null then
    if target_rank > current_rank then
      update public.orders set
        status = target_status,
        status_rank = target_rank,
        stripe_checkout_session_id = case
          when event_type like 'checkout.session.%' then coalesce(stripe_checkout_session_id, object_id)
          else stripe_checkout_session_id
        end,
        stripe_payment_intent_id = coalesce(
          stripe_payment_intent_id,
          case
            when jsonb_typeof(provider_object -> 'payment_intent') = 'string'
              then provider_object ->> 'payment_intent'
            when event_type like 'payment_intent.%' then object_id
            else null
          end
        ),
        updated_at = now()
      where id = target_order_id;
      result := 'applied';
    else
      result := 'stale';
    end if;
  end if;

  begin
    insert into public.stripe_events (
      provider_event_id, event_type, event_created_at, livemode,
      order_id, provider_object_id, outcome
    ) values (
      provider_event_id, event_type, to_timestamp(event_created_at), event_livemode,
      case when current_rank is null then null else target_order_id end, object_id, result
    );
  exception when unique_violation then
    return 'duplicate';
  end;
  return result;
end;
$$;

revoke all on function public.ingest_stripe_event(text, text, bigint, boolean, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.ingest_stripe_event(text, text, bigint, boolean, text, jsonb)
  to service_role;
