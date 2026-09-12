create table public.payment_products (
  code text primary key,
  currency text not null check (currency ~ '^[a-z]{3}$'),
  amount_total bigint not null check (amount_total > 0),
  active boolean not null default true
);

insert into public.payment_products (code, currency, amount_total)
values ('starter-support', 'usd', 500);

alter table public.payment_products enable row level security;
alter table public.orders add column product_code text references public.payment_products(code);
alter table public.orders add column checkout_attempt_id uuid unique;
alter table public.orders drop constraint orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('created', 'checkout_failed', 'checkout_open', 'payment_failed', 'expired', 'paid', 'refunded'));

create or replace function public.create_checkout_order(product_code text, checkout_attempt uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  existing public.orders;
  product public.payment_products;
  created_id uuid;
begin
  if caller is null then raise exception 'authentication required'; end if;
  select * into existing from public.orders where checkout_attempt_id = checkout_attempt;
  if found then
    if existing.user_id <> caller or existing.product_code <> product_code then
      raise exception 'checkout attempt conflict';
    end if;
    return existing.id;
  end if;
  select * into product from public.payment_products where code = product_code and active;
  if not found then raise exception 'product unavailable'; end if;
  insert into public.orders (user_id, product_code, checkout_attempt_id, currency, amount_total)
  values (caller, product.code, checkout_attempt, product.currency, product.amount_total)
  returning id into created_id;
  return created_id;
exception when unique_violation then
  select * into existing from public.orders where checkout_attempt_id = checkout_attempt;
  if existing.user_id = caller and existing.product_code = product_code then return existing.id; end if;
  raise;
end;
$$;

revoke all on function public.create_checkout_order(text, uuid) from public, anon;
grant execute on function public.create_checkout_order(text, uuid) to authenticated;

create or replace function public.attach_checkout_session(order_id uuid, checkout_session_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if checkout_session_id !~ '^cs_(test_|live_)[A-Za-z0-9]+$' then
    raise exception 'invalid Checkout Session id';
  end if;
  update public.orders set
    stripe_checkout_session_id = coalesce(stripe_checkout_session_id, checkout_session_id),
    status = case when status_rank < 10 then 'checkout_open' else status end,
    status_rank = greatest(status_rank, 10),
    updated_at = now()
  where id = order_id
    and (stripe_checkout_session_id is null or stripe_checkout_session_id = checkout_session_id);
  if not found then raise exception 'order unavailable or session conflict'; end if;
end;
$$;

create or replace function public.mark_checkout_creation_failed(order_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.orders set status = 'checkout_failed', status_rank = 5, updated_at = now()
  where id = order_id and status_rank < 5;
end;
$$;

revoke all on function public.attach_checkout_session(uuid, text) from public, anon, authenticated;
revoke all on function public.mark_checkout_creation_failed(uuid) from public, anon, authenticated;
grant execute on function public.attach_checkout_session(uuid, text) to service_role;
grant execute on function public.mark_checkout_creation_failed(uuid) to service_role;

-- Replace the alpha.6 foundation function so paid events must reconcile the
-- server-owned catalog amount/currency before advancing an order.
create or replace function public.ingest_stripe_event(
  provider_event_id text, event_type text, event_created_at bigint,
  event_livemode boolean, order_reference text, provider_object jsonb
)
returns text language plpgsql security definer set search_path = '' as $$
declare
  target_order_id uuid;
  target_status text;
  target_rank smallint;
  current_rank smallint;
  expected_amount bigint;
  expected_currency text;
  result text := 'ignored';
  object_id text := provider_object ->> 'id';
begin
  if provider_event_id !~ '^evt_[A-Za-z0-9_]+$' or event_created_at <= 0 then
    raise exception 'invalid Stripe event identity';
  end if;
  begin target_order_id := order_reference::uuid;
  exception when invalid_text_representation then target_order_id := null;
  end;
  if target_order_id is not null then
    select status_rank, amount_total, currency into current_rank, expected_amount, expected_currency
    from public.orders where id = target_order_id for update;
  end if;
  case event_type
    when 'checkout.session.completed' then
      if provider_object ->> 'payment_status' = 'paid'
        and (provider_object ->> 'amount_total')::bigint = expected_amount
        and provider_object ->> 'currency' = expected_currency
      then target_status := 'paid'; target_rank := 30; end if;
    when 'checkout.session.async_payment_succeeded' then
      if (provider_object ->> 'amount_total')::bigint = expected_amount
        and provider_object ->> 'currency' = expected_currency
      then target_status := 'paid'; target_rank := 30; end if;
    when 'checkout.session.expired' then target_status := 'expired'; target_rank := 20;
    when 'checkout.session.async_payment_failed' then target_status := 'payment_failed'; target_rank := 20;
    when 'payment_intent.payment_failed' then target_status := 'payment_failed'; target_rank := 20;
    else null;
  end case;
  if current_rank is not null and target_rank is not null then
    if target_rank > current_rank then
      update public.orders set
        status = target_status, status_rank = target_rank,
        stripe_checkout_session_id = case when event_type like 'checkout.session.%'
          then coalesce(stripe_checkout_session_id, object_id) else stripe_checkout_session_id end,
        stripe_payment_intent_id = coalesce(stripe_payment_intent_id,
          case when jsonb_typeof(provider_object -> 'payment_intent') = 'string'
            then provider_object ->> 'payment_intent'
            when event_type like 'payment_intent.%' then object_id else null end),
        updated_at = now()
      where id = target_order_id;
      result := 'applied';
    else result := 'stale';
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
  exception when unique_violation then return 'duplicate';
  end;
  return result;
end;
$$;
