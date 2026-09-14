# OpenElement SaaS (Supabase × Cloudflare)

> Independent first-party consumer application for OpenElement, maintained
> in this repository but governed separately: it exercises the public framework
> surface end to end. It is not framework core and not part of the Alpha
> repository candidate. New projects should still start from
> `@openelement/create`.

Maintained first-party SaaS for the OpenElement × Supabase × Cloudflare
fullstack delivery path. Composition only: no framework-owned auth/database
abstractions — Supabase owns data/Auth/RLS, Cloudflare owns edge delivery,
OpenElement is the Web Components-native application layer.

## Status

Implemented and unit-tested in this candidate. Hosted and deployed
qualification is external pending; see
[Qualification status](#qualification-status).

- [x] application shell + request-time routes (login, signup, Magic Link,
      PKCE callback, recovery/reset, notes, upload, admin)
- [x] real sign-in/sign-out via @supabase/ssr cookies on the ADR-0129
      response-header channel (`lib/supabase-server.ts`)
- [x] /notes loader: getUser + RLS-scoped query; anonymous renders the denied
      branch over a hard database-level RLS floor
- [x] explicit `middleware.corsOrigin` allowlist (deployed worker + localhost)
- [x] /upload: no-JS multipart upload/list/delete in the private
      `notes-attachments` bucket; unpredictable object ids, MIME/size guards,
      60-second signed downloads, Storage RLS, and atomic Postgres quota
      reservation/release reject anonymous, cross-user, and quota-race access;
      objects are immutable after INSERT (no UPDATE/upsert policy)
- [x] application-owned Cloudflare module entry composes Nitro `fetch` with
      Queue scan and Cron reconciliation handlers; unscanned objects stay
      hidden, duplicate verdicts are idempotent, and lifecycle events are audited
- [x] deployment renders a generated bounded Queue/DLQ/Cron overlay from the
      one safe Wrangler source; DLQ rows persist before ack and admin replay
      is durable; no duplicate provider config is maintained
- [x] notes-live island: Supabase Realtime INSERT subscription in the browser,
      RLS-scoped via the user's short-lived access token + a hard `user_id`
      filter, with bounded/deduplicated state and a periodic RLS Data API
      reconciliation fallback; the one-shot SSR token is removed after
      `setAuth`, retained only in element-private memory for reconnect, wiped
      on disconnect, and never persisted as a browser session
- [x] admin authorization reads issuer-controlled `app_metadata.role` only;
      matching RLS and immutable append-only audit migration included
- [x] Stripe webhook ingress preserves and verifies the raw body before JSON
      parsing, enforces timestamp tolerance, durably deduplicates provider event
      ids, and applies only monotonic order-state transitions
- [x] one-time Checkout uses Dashboard-managed dynamic payment methods, a
      server-owned catalog, retry-stable attempt ids and Stripe idempotency
      keys; Session and PaymentIntent metadata carry the order id, paid events
      must reconcile amount/currency, and the success URL never grants payment
      state
- [x] verified Stripe events persist a minimal envelope before Queue handoff;
      the Queue consumer owns state transitions, exhausted delivery becomes a
      durable admin-visible DLQ row, and Cron safely re-enqueues received events
      and requested replays

## Prerequisites

- Deno (workspace tasks), Node (Nitro `node` preset run),
- Supabase CLI + Docker (local emulator; migrations), or a hosted project,
- Cloudflare account for deployment (wrangler; see
  [`docs/runbooks/payment-events.md`](../../docs/runbooks/payment-events.md)
  for the server-side secret boundary),
- An operator-selected malware scanner for production attachment scanning.
  MetaDefender Core is a reference adapter; the scanner fails closed when no
  provider is configured.

## Tasks

```sh
deno task build        # OpenElement build (dist/, request-time server entry)
deno task nitro:build  # Nitro build (OPEN_ELEMENT_NITRO_PRESET=cloudflare_module → .output-workers/)
deno task start        # local run of the built server (http://localhost:4173)
deno task check        # type-check routes, islands, shell, lib
deno task test         # unit smoke for route logic (stubbed Supabase client)
```

## Migrations

```sh
supabase start          # local emulator
supabase migration up   # apply ordered migrations locally
```

Local development and tests run against the emulator. Hosted-project
migration and deployment qualification is external pending; the operator
procedure, credential boundary, and rollback policy are documented in
[`docs/runbooks/supabase-migrations.md`](../../docs/runbooks/supabase-migrations.md).
Runtime service-role credentials are not migration credentials.

Payment delivery, DLQ recovery, and replay operations are documented in
[`docs/runbooks/payment-events.md`](../../docs/runbooks/payment-events.md).

Required worker env (server-side only, never in the client bundle):

```
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_LIVEMODE
STRIPE_SECRET_KEY
STRIPE_PRICE_ID
STRIPE_CHECKOUT_HOST
APP_ORIGIN
```

The scanner Worker uses a provider-neutral contract (ADR-0139). When no
provider is configured, uploads stay `pending_scan` and remain undownloadable
by everyone. The maintained MetaDefender reference adapter uses:

```
METADEFENDER_CORE_URL
METADEFENDER_API_KEY
```

Optional OAuth provider switches (default off; a provider renders on `/login`
only when its flag is exactly `true` and the provider is configured in the
Supabase dashboard — otherwise the page shows
"OAuth providers: not configured" and the `oauth` action fails closed):

```
SUPABASE_OAUTH_GOOGLE_ENABLED
SUPABASE_OAUTH_GITHUB_ENABLED
```

The anon key is additionally rendered into the /notes page as a data attribute
for the realtime island — it is a public key by design; row visibility stays
enforced by RLS and the island's `user_id` filter. The service-role and Stripe
webhook secrets are server-only Worker bindings used by lifecycle/webhook
handlers and must never be rendered or prefixed with `VITE_`.

## Qualification status

External qualification is pending. The following claims are **not** proven by
this candidate and must be re-established by an operator against a hosted
project and a deployed Worker:

- **Hosted Auth/session/Notes matrix (Tier 2): external pending.** Requires a
  hosted Supabase project, real password/OAuth/RLS/Realtime journeys, and a
  recorded result on the exact candidate. The local emulator and stubbed unit
  suites do not substitute.
- **Deployed Workers journey and Cloudflare rate limiting (Tier 3): external
  pending.** Requires a Cloudflare account, deployed Queues/DLQ/Cron bindings,
  and the production rate-limit rule. No "deployed green" claim is made here.
- **Production SMTP domain authentication and signup email-confirmation
  E2E: external pending.** Requires a verified sender domain in the hosted
  project. Known operational caveat: a fresh sender domain has zero
  reputation, so the first mail can land in spam on some providers;
  reputation ramps with volume, not a code defect.
- **Real scan-engine qualification: external pending** (ADR-0139). The
  provider-neutral fail-closed state machine is implemented and unit-tested
  without commercial credentials or paid container infrastructure.
