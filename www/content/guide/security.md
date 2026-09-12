---
title: 'Security'
lede: 'The built-in CSRF same-origin floor for actions, plus the middleware recipe for API routes and ambient-auth apps.'
order: 95
---

## Standing assumption

Generated action POST handlers ship with a fail-closed same-origin floor (ADR-0121 §12 amendment): a request is rejected when `Sec-Fetch-Site` is `cross-site`, when `Origin` is present and does not match the request URL origin, or when `Sec-Fetch-Site` is `same-site` but `Origin` is missing or `null` — a forged header, since browsers always send `Origin` on POST (#921). Loopback hostname aliases (`localhost` / `127.0.0.1` / `[::1]`) count as the same origin (#937). Clients that omit both headers (typical non-browser tools) are allowed. Set `OPEN_ELEMENT_DISABLE_CSRF=1` on the request env binding (`c.env` / Nitro runtime env) to opt out. Framework-owned session APIs are not in the current contract; provider recipes own their cookie/session transport and must apply the same-origin floor plus explicit cookie attributes.

## Ambient authentication

Apps authenticated by ambient credentials — HTTP Basic, mTLS, or cookies set with `SameSite=None` — cannot rely on the Lax default: the browser attaches those credentials to cross-site requests. The built-in same-origin floor covers generated action POSTs, but such apps should validate the request origin on every state-changing API route as well.

## Redirect targets

`redirect()` validates the status (3xx whitelist) but never the location — targets are author-controlled code, as in SvelteKit. An action that redirects to user-supplied input (a `?next=` parameter, a stored URL) is an open redirect: validate or allowlist such targets in the action before calling `redirect()`.

## Middleware recipe

The built-in floor guards generated action handlers only. For custom API routes — and as defense in depth for ambient-auth apps — drop the middleware below into `app/routes/_middleware.ts`. A root `_middleware.ts` default-exports a Hono middleware scoped to `/*`, in front of every page action and API route. It allows safe methods and same-site Fetch Metadata, and falls back to an `Origin` allowlist for older browsers.

### app/routes/_middleware.ts

```ts
import type { Context, Next } from 'hono';

// CSRF guard for custom API routes and defense in depth (ADR-0121 §12):
// generated action POST handlers already enforce a fail-closed same-origin
// floor (opt out with OPEN_ELEMENT_DISABLE_CSRF=1 on the request env). Apps
// using ambient authentication (Basic, mTLS, SameSite=None cookies) should
// also reject cross-site state-changing requests on their API routes.
const ALLOWED_ORIGINS = new Set(['https://app.example.com']);

export default async function csrfGuard(c: Context, next: Next) {
  const method = c.req.method;
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next();
  }
  // Fetch Metadata: same-origin/same-site submissions and user-typed
  // navigations are always fine.
  const site = c.req.header('sec-fetch-site');
  if (site === 'same-origin' || site === 'same-site' || site === 'none') {
    return next();
  }
  // Older browsers without Fetch Metadata: fall back to the Origin header.
  const origin = c.req.header('origin');
  if (origin && ALLOWED_ORIGINS.has(new URL(origin).origin)) {
    return next();
  }
  return c.text('Forbidden', 403);
}
```

`middleware.corsOrigin` (the `openElement()` option) governs cross-origin resource sharing only — it is not a CSRF check. The two compose: CORS for reads, this guard for writes. Guards that do not need the Hono context can also ride `middleware.use` — the dialect-free fetch middleware chain composed at the handler boundary with identical dev/start/Nitro semantics (see [Configuration → middleware.use](/guide/configuration#middleware-use)).

## Safe HTML by default

Render untrusted HTML fragments (markdown output, CMS content, third-party HTML) through `sanitizeHtml` from `@openelement/element/sanitize` — an allow-list sanitizer with a decode-then-revalidate URL scheme policy (ADR-0126). Use `trustedHtml` only when you sanitized upstream; it is a trust boundary, not a sanitizer.
