# ADR-0153: Beta.2.2 resolved Document seam and effective submission tuple

- Status: PROPOSED (2026-09-10, Beta.2.2 implementation record; maintainer
  acceptance pending — no acceptance record exists yet)
- Amends: ADR-0122 (touches its §1/§2/§3 frozen paths — see "Frozen-path
  accounting"); preserves ADR-0148, ADR-0152.
- Tracking: [#1326](https://github.com/open-element/openelement/issues/1326),
  [#1339](https://github.com/open-element/openelement/issues/1339).

## Context

Beta.2.2 makes the Native and Lit Framework Mode paths run the same real
application flows. Two findings required changes inside ADR-0122 frozen paths:

1. Page meaning (title/description/canonical/hreflang/locale) had no single
   owner: generated entries read `page.head` fields ad hoc at each
   serialization site, and www additionally rewrote built HTML after the fact
   (the post-build SEO pass). #1326 requires a thin resolved-Document boundary
   decided once per render, before final serialization.
2. The enhanced form interceptor decided from the FORM's attributes only:
   submitter overrides (formaction/formmethod/formenctype/formtarget) were
   ignored, and every enhanced POST carried a `multipart/form-data` body
   because FormData was handed to fetch directly — silently breaking the
   ADR-0120 rule-2 promise that the enhanced and native wire bodies never
   differ (the platform default enctype is `application/x-www-form-urlencoded`).

## Decision

1. **`resolvePageDocument` (`@openelement/app/document`) is the single page-
   meaning seam.** A descriptor `head` is a static object or a resolver
   receiving the same request-scoped context object the props projector gets;
   resolution is pure (no fetch, no cache, no global request, no nested
   loaders) and happens exactly once per render in the generated SSG,
   request-time, error-boundary and styled-404 paths. Serializers consume the
   resolved document; `wrapInDocument` emits sanitized `<link>` tags. The
   www public catalog (sitemap/search/SEO) reuses the same resolution policy
   from the route catalog and never reads request-private Documents.
2. **The enhanced submit interceptor computes the platform's effective
   submission tuple** — submitter, action, method, enctype, target,
   validation state — with submitter overrides winning over form attributes
   and platform missing/invalid defaults (GET, urlencoded). All interception
   decisions read the fully computed tuple before `preventDefault()`:
   non-default targets, cross-origin actions, non-POST effective methods
   (including `dialog` and invalid methods) and `text/plain` bodies fall back
   to native submission untouched. Enhanced POSTs serialize urlencoded bodies
   byte-identically to native (file controls contribute their filename) with
   the exact native Content-Type; multipart passes FormData through and the
   boundary is never hand-set.

## Consequences

- Frozen-path accounting (ADR-0122): `packages/app/src/authoring.ts` (§1) gains
  the head-resolver descriptor channel — the loop contract algebra
  (fail/redirect/notFound/action outcomes) is unchanged.
  `packages/adapter-vite/src/internal/ssg/entry-codegen.ts` (§2/§3) emits the
  document-seam call — the CSRF fail-closed default and the action response
  channels are unchanged. `form-enhance.ts` (§2) implements the tuple —
  interception remains fail-closed toward native behavior. This ADR is the
  amendment reference for those touches.
- The deleted post-build SEO rewrite (tools/apply-www-seo.ts,
  tools/lib/www-seo.ts, www/app/seo.ts) has no second write path; built-output
  assertion gates remain as verification.
- `text/plain` forms are deliberately not enhanced; if a future need appears,
  implementing its exact body format is a separate amendment with wire tests.
- Renderer selection stays explicit (`openElement({ renderer })`); the Lit
  server graph resolves the HTML/logger/authoring leaves and never the Native
  runtime barrel (pinned by lit-graph-boundary.test.ts and the packed-consumer
  leaf-graph walk).
