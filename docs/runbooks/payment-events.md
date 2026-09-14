# Runbook: SaaS payment events

Scope: Stripe webhook ingress, durable event storage, Cloudflare Queue
delivery, dead-letter handling, and admin replay for `apps/saas`. This runbook
contains no tokens and no live provider data; local verification uses
test-mode credentials only.

## Boundaries

Server-only Worker bindings. Never render them, never log them, never prefix
them with `VITE_`:

- `STRIPE_WEBHOOK_SECRET` — verifies the raw webhook body.
- `STRIPE_SECRET_KEY` — server-side Stripe API calls.
- `SUPABASE_SERVICE_ROLE_KEY` — service-role lifecycle RPCs.

Additional rules:

- The webhook handler verifies the signature over the raw body before any JSON
  parsing and enforces a timestamp tolerance. Never parse or trust an
  unverified payload.
- Provider event ids are deduplicated durably; a replay of the same event must
  stay a no-op.
- Order state only moves forward. Do not edit order or event rows by hand; the
  Queue consumer owns transitions.
- The Checkout success URL never grants payment state; only a verified paid
  event does.

## Flow

1. Stripe POSTs to `/api/stripe-webhook`.
2. The handler verifies the raw body, deduplicates the event id, and persists a
   minimal envelope before acknowledging.
3. The envelope is handed to the `openelement-payment-events` Queue.
4. The Queue consumer applies the state transition; exhausted delivery is
   persisted to the `openelement-payment-events-dlq` dead-letter queue before
   ack.
5. Cron safely re-enqueues `received` events and requested replays.

Event `processing_state` values: `received`, `processing`, `completed`,
`dead_letter`, `replay_requested`.

## Local verification (test mode)

Use the Stripe CLI against the local server; test-mode keys only:

```sh
deno task start   # local server on http://localhost:4173
stripe listen --forward-to http://localhost:4173/api/stripe-webhook
stripe trigger checkout.session.completed
```

Expected: a verified event is persisted once, the Queue consumer reaches
`completed`, and repeating the same trigger does not double-apply.

## Inspect state (read-only)

Run with the service-role connection or the Supabase SQL editor:

```sql
select id, processing_state, received_at, replay_requested_at
from public.stripe_events
order by received_at desc
limit 20;

select id, processing_state, received_at
from public.stripe_events
where processing_state in ('dead_letter', 'replay_requested')
order by received_at
limit 20;
```

Never update these rows directly; all transitions go through the Queue consumer
or the replay RPCs.

## Replay

Admin replay is durable and idempotent:

- From the authenticated `/admin` page, request replay for the event id
  (authorization reads issuer-controlled `app_metadata.role` only).
- Or call the authenticated RPC as an admin session:

```sql
select public.request_payment_event_replay('<event-id>');
```

The request marks the event `replay_requested`; Cron then re-enqueues it and
`mark_payment_event_replay_enqueued` records the handoff. Service-role-only
helpers (`list_pending_payment_events`, `mark_payment_event_replay_enqueued`)
are not callable by `anon` or `authenticated`.

## Incident checks

- Webhook failures: confirm the endpoint secret matches the Stripe endpoint,
  then re-send the event from the Stripe dashboard rather than replaying a
  stale payload by hand.
- Stuck events: check `dead_letter` rows, fix the downstream cause, then
  request replay; do not delete the row.
- Key rotation: update the Worker binding, redeploy, and verify with a new
  test-mode event before trusting live traffic.
