# Runbook: SaaS payment events

This runbook covers Stripe webhook ingress, durable event storage, Cloudflare
Queue delivery, dead-letter handling, and admin replay for one-time Checkout
payments in `apps/saas`.

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

## Local verification

Run the SaaS checks from the repository root.

```sh
vp run saas:verify
vp run saas:workers
```

The tests exercise webhook and lifecycle behavior with stubbed provider and
Queue calls. The Workers task verifies the local build and its boundary. Plain
`oe start` has no `PAYMENT_EVENT_QUEUE` binding, so the webhook responds with
503 before accepting an event.

## Staging verification (test mode)

Follow the [SaaS staging checklist](../../apps/saas/STAGING-CHECKLIST.md) for
the candidate Worker, Supabase migrations, and Queue, DLQ, and Cron bindings.
Set `STRIPE_LIVEMODE` to `false` and configure the test-mode webhook endpoint
at the staging Worker's `/api/stripe-webhook` using its endpoint signing
secret as a Worker binding.

Complete a one-time Checkout Session created by the staging app. Check that
the signed provider event is stored, the Queue consumer reaches `completed`,
and the matching order becomes paid. Resend the original Stripe event ID and
verify that the event has one durable row and the order transition occurs
once. Record the candidate revision and observed result using the staging
checklist.

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
