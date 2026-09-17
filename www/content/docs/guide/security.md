---
title: 'Security'
lede: 'The built-in CSRF same-origin floor for actions, plus the middleware recipe for API routes and ambient-auth apps.'
order: 95
---

## Standing assumption

Generated action POST handlers ship with a fail-closed same-origin floor (ADR-0121 §12 (retired; recoverable from Git history) amendment): a request is rejected when `Sec-Fetch-Site` is `cross-site`, when `Origin` is present and does not match the request URL origin, or when `Sec-Fetch-Site` is `same-site` but `Origin` is missing or `null` — a forged header, since browsers always send `Origin` on POST (#921). Loopback hostname aliases (`localhost` / `127.0.0.1` / `[::1]`) count as the same origin (#937). Clients that omit both headers (typical non-browser tools) are allowed. Set `OPEN_ELEMENT_DISABLE_CSRF=1` on the request env binding (`c.env` / Nitro runtime env) to opt out. Framework-owned session APIs are not in the current contract; provider recipes own their cookie/session transport and must apply the same-origin floor plus explicit cookie attributes.

## Ambient authentication

Apps authenticated by ambient credentials — HTTP Basic, mTLS, or cookies set with `SameSite=None` — cannot rely on the Lax default: the browser attaches those credentials to cross-site requests. The built-in same-origin floor covers generated action POSTs, but such apps should validate the request origin on every state-changing API route as well.

## Redirect targets

`redirect()` validates the status (3xx whitelist) but never the location — targets are author-controlled code, as in SvelteKit. An action that redirects to user-supplied input (a `?next=` parameter, a stored URL) is an open redirect: validate or allowlist such targets in the action before calling `redirect()`.

## Middleware recipe

The built-in floor guards generated action handlers only. For custom API routes — and as defense in depth for ambient-auth apps — drop the middleware below into `app/routes/_middleware.ts`. A root `_middleware.ts` default-exports a WinterCG fetch middleware `(request, next) => Promise<Response>` scoped to `/*`, in front of every page action and API route. It allows safe methods and same-site Fetch Metadata, and falls back to an `Origin` allowlist for older browsers.

### app/routes/_middleware.ts

```ts
// CSRF guard for custom API routes and defense in depth (ADR-0121 §12, retired; recoverable from Git history):
// generated action POST handlers already enforce a fail-closed same-origin
// floor (opt out with OPEN_ELEMENT_DISABLE_CSRF=1 on the request env). Apps
// using ambient authentication (Basic, mTLS, SameSite=None cookies) should
// also reject cross-site state-changing requests on their API routes.
const ALLOWED_ORIGINS = new Set(['https://app.example.com']);

export default async function csrfGuard(request: Request, next: () => Promise<Response>) {
  const method = request.method;
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next();
  }
  // Fetch Metadata: same-origin/same-site submissions and user-typed
  // navigations are always fine.
  const site = request.headers.get('sec-fetch-site');
  if (site === 'same-origin' || site === 'same-site' || site === 'none') {
    return next();
  }
  // Older browsers without Fetch Metadata: fall back to the Origin header.
  const origin = request.headers.get('origin');
  if (origin && ALLOWED_ORIGINS.has(new URL(origin).origin)) {
    return next();
  }
  return new Response('Forbidden', { status: 403 });
}
```

`middleware.corsOrigin` (the `openElement()` option) governs cross-origin resource sharing only — it is not a CSRF check. The two compose: CORS for reads, this guard for writes. Guards that span the whole app rather than a route subtree can also ride `middleware.use` — the dialect-free fetch middleware chain composed at the handler boundary with identical dev/start/Nitro semantics (see [Configuration → middleware.use](/guide/configuration#middleware-use)).

## Content Security Policy

`middleware.csp` (`{ policy, nonce, reportOnly }`) emits a Content-Security-Policy on request-time responses. Like every built-in middleware it guards the request-time dispatch path only: prerendered static pages never pass through the middleware chain, so SSG output carries the policy as a build-time `<meta http-equiv="Content-Security-Policy">` tag instead of an HTTP header.

With `nonce: true` the generated server mints a per-request nonce (a random 32-hex value, fresh on every request), exposes it to the render pipeline as the request-scoped `cspNonce`, and prepends `'nonce-<value>'` to `script-src` (adding a `script-src` directive when the policy has none). Every framework-generated `<script>` — the island client entry, the dev client, styled 404/500 pages — is attached through `wrapInDocument`'s script descriptors, the single attachment point, so each one carries the nonce of its own response. Pair the nonce with `script-src 'strict-dynamic'`: the nonced island client entry may then import its chunks without a host allowlist. Raw head fragments can never inject `<script>` (see the HTML trust boundary below), so the descriptor pipeline stays the only script source.

Nonces are per-request by construction and therefore impossible in static files: a pure-static (SSG) build with `nonce: true` logs a warning and falls back to a policy-only `<meta>` tag. That fallback is fail-closed — with `script-src 'strict-dynamic'` the policy-only page has no nonce source and no allowlist, so the browser blocks **every** script and islands never hydrate. For pure-static sites either write a nonce-free policy (for example `script-src 'self'`, which covers the external island client) or keep `nonce: true` only on projects that serve request-time routes.

Set `reportOnly: true` to swap the header (and the SSG meta tag) to `Content-Security-Policy-Report-Only`: the browser reports violations without enforcing them, which is the rollout posture for a new policy.

### vite.config.ts — CSP with per-request nonce

```ts
import { defineConfig } from 'vite';
import { openElement } from '@openelement/router/vite';

export default defineConfig({
  plugins: [
    openElement({
      middleware: {
        csp: {
          nonce: true,
          policy:
            "default-src 'self'; script-src 'strict-dynamic'; style-src 'self' 'unsafe-inline'",
        },
      },
    }),
  ],
});
```

## HTML trust boundary

`trustedHtml` is the framework's explicit trust boundary for HTML: only values created by `trustedHtml()` reach `html` Parts and `innerHTML` sinks — ordinary strings are rejected at render time. The framework ships no HTML sanitizer, so sanitize untrusted fragments (user input, CMS output, third-party HTML) at your own system boundary, before the data enters the framework. Raw head fragments (`headExtras`, `inject.headFragments`) are likewise developer-trusted input; the framework enforces only no-`<script>` and no-executable-`<style>`.
