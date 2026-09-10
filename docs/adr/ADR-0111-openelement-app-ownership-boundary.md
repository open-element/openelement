# ADR-0111: Router and app-package ownership boundary

- Status: ACCEPTED (reconciled for `1.0.0-alpha.1` on 2026-09-11)
- Depends on: ADR-0110, ADR-0152

## Decision

`@openelement/app` is the current distribution owner for Router:

- Route Mode exposes explicit records, deterministic matching, HTTP method policy, and optional
  Hono integration. Its pure matching and browser projections do not require Element or a renderer.
- Framework Mode adds file routing, request-scoped loaders/actions, forms, Document, navigation,
  SSR/SSG, and explicit Native or Lit renderer integration.

Vite owns supported build integration. Hono owns HTTP context and middleware mechanics. Nitro is a
deployment target, not an application model. These dependencies must not become competing owners
of route identity, page selection, or document meaning.

No example, hosted site, desktop shell, or SaaS application may add an app-specific concept to the
public Router contract without an independently reviewed boundary decision.

## Verification

The repository proves pure Route Mode without Element/renderers and proves Native and Lit Framework
Mode in separate packed consumer environments. Server/client graph checks prevent build-only or
renderer-specific code from leaking across those boundaries.
