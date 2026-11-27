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
- [x] /workspaces: signed-in users create a workspace and become its admin in
      one transaction. Admins generate single-use invitation codes that expire
      after 24 hours. Redeeming a code grants member access to that workspace.
      PostgreSQL stores the SHA-256 digest of each code.
- [x] explicit `middleware.corsOrigin` allowlist (deployed worker + localhost)
- [x] /upload: no-JS upload, list, download and delete for private attachments.
      The server reserves quota before writing an object. Downloads require a
      signed-in owner and a clean scan and stream through the application
      with no-store. Direct user Storage operations are denied. Failed uploads
      and interrupted deletes leave a reservation for scheduled cleanup.
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

- Node.js 24.2+ and pnpm (all workspace tasks),
- Supabase CLI + Docker (local emulator; migrations), or a hosted project,
- Cloudflare account for deployment (wrangler; see
  [`docs/runbooks/payment-events.md`](../../docs/runbooks/payment-events.md)
  for the server-side secret boundary),
- An operator-selected malware scanner for production attachment scanning.
  MetaDefender Core is a reference adapter; the scanner fails closed when no
  provider is configured.

## Tasks

```sh
vp run saas:verify   # local typecheck and stubbed unit tests
vp run saas:workers  # local application and Workers builds + boundary check
vp run --no-cache --fail-if-no-match --filter @openelement/saas test:workspace-rls
vp run --no-cache --fail-if-no-match --filter @openelement/saas test:attachment-storage
vp run --no-cache --fail-if-no-match --filter @openelement/saas test:workspace-onboarding:browser
```

Run these tasks from the repository root after the frozen-lockfile install
described in [the agent contract](../../docs/agent-contract.md). The RLS proof
requires `initdb`, `pg_ctl`, and `psql` on PATH and verifies the workspace
migrations, including concurrent invitation redemption, in a disposable
Postgres cluster. The attachment Storage proof applies the full migration
chain in a disposable PostgreSQL catalog and verifies broker privileges,
reconciliation and rescanning of inherited attachments. Build the SaaS app
before running the browser proof. The
browser proof uses Chromium and a loopback Auth and Data API fixture. It
exercises creation and joining with JavaScript disabled and checks code
issuance and its no-store responses. Use the
[staging checklist](STAGING-CHECKLIST.md) to record hosted provider evidence.

Open **Workspaces** from Notes after sign-in to create or join a workspace.
A workspace admin can generate a code in **Workspace invitations** and share
it with the intended recipient. Generation requires JavaScript because the
issuing response delivers the code once. The recipient pastes the code into
**Join a workspace** while signed in.

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

For the operator's detailed two-workspace and hosted-provider acceptance matrix,
see [the staging checklist](STAGING-CHECKLIST.md). This is a procedure, not a
record of completed hosted qualification.
