# ADR-0129: Response-Header Channel for Loaders and Actions

- Status: ACCEPTED (2026-08-16, maintainer decision; implements the
  additive channel below)
- Date: 2026-08-16
- Amends: ADR-0122 §1 (the loop contract gains one additive channel; no
  existing semantics change)
- Unblocks: #981 (Supabase × Cloudflare delivery path), recipe-based
  signed-in apps (ADR-0122 §6)

## Context

The alpha.3 fullstack spike (#981, `tools/fullstack-spike-workers.ts`,
824b11cf) proved the Workers runtime seam works — CSRF floor and `c.env`
included — except one thing: **there is no framework channel for writing
response headers from a loader or action**. Session sign-in needs to write
`Set-Cookie` exactly when authentication succeeds:

- `redirect(location, status)` takes no headers (ADR-0121 §3);
- an action returning a `Response` is rejected by design (ADR-0121 §2);
- `OpenElementRequestContext` (packages/router/src/model.ts) is read-only —
  `request`, `url`, `params`, `env`, `platform`, nothing mutable;
- the middleware layer cannot substitute: the cookie value exists only
  after the action completes, and middleware shares nothing with the
  action but the immutable-by-convention Request (header smuggling is a
  hack we refuse to document as a recipe).

Without this channel, recipe-based sessions (the ADR-0122 §6 supported
path) cannot work at all.

## Decision

**Additive amendment: a mutable response-header channel on the
loader/action context.**

1. The generated request-time entry creates one `Headers` instance per
   request and exposes it to the loader and the action as
   `context.responseHeaders`.
2. Route code appends to it (`context.responseHeaders.append('Set-Cookie',
   …)`). `Headers` is the Web-standard interface — `Set-Cookie` is the one
   header with multi-value semantics, and `Headers.append` models it
   correctly.
3. The entry merges the channel into **every** response of that request —
   success render, failure re-render, redirect (native and fetch-channel
   JSON alike; the enhance client's fetch honors `Set-Cookie` for
   same-origin requests), and the error-boundary fallback. Merge order:
   channel entries are appended after framework-set headers; framework
   protocol headers (`x-openelement-action`, `Vary`, `Cache-Control`,
   `Location`, `Content-Type`) always win on conflict — the channel cannot
   override the protocol.
4. The channel is per-request and mutable only during loader/action
   execution; post-response mutation is a no-op (documented).

Explicitly out of scope (0.44): cookie parsing/signing helpers, session
stores, flash data, any framework-owned session primitive.

## Consequences

- Signed-in apps can implement session cookies entirely in recipe code —
  the Supabase SSR cookie adapter maps onto `context.responseHeaders`
  directly, and the #983 reference application proceeds.
- ADR-0122 §1's algebra is unchanged: `fail()`/`redirect()` signatures,
  statuses, and encodings are untouched; the channel is orthogonal.
- Security note (to be recorded in the security guide): the channel is
  author-controlled code, like the handler itself; recipes must document
  cookie attributes (`HttpOnly; Secure; SameSite=Lax; Path=/`) explicitly.
- The freeze gate (`freeze:semantics:check`) treats the context type and
  entry-codegen merge as frozen paths; this ADR is their amendment
  reference.
