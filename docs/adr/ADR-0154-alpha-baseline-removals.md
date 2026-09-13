# ADR-0154: 1.0 Alpha baseline removals (polyfill, hand infra, sanitizer, experiments)

- Status: ACCEPTED (2026-09-13, 1.0.0-alpha.1 convergence)
- Amends: none as frozen law; retires the `sanitizeHtml` direction recorded in
  site docs and the `headExtras` allow-list rewriting behavior.

## Context

The Alpha baseline rule is Web Standards first, then Deno/`@std/*`, then a
mature third party, and first-party generic infrastructure only with a proven
need. Three first-party pieces failed that test, and three ended experiments
had no remaining consumer. 1.0 Alpha is a fresh baseline: no compatibility
layers, no superseded implementations, no migration guide beyond the one-line
new-baseline statement.

## Decision

1. **Native `URLPattern` only.** All Alpha targets (Deno 2.9, Node 24,
   current Chromium/Firefox/WebKit) ship the Web Standard `URLPattern`; the
   `urlpattern-polyfill` fallback is deleted from the route core, its tests,
   and the import map. A missing implementation fails closed with a locatable
   `TypeError`. The product-semantic `URLPatternList` (priority/identity)
   stays: it is OpenElement routing semantics, not a platform gap-fill.
2. **`@std/jsonc` owns JSONC.** The `jsonc-parser` npm dependency is replaced
   by `jsr:@std/jsonc`; the config-reader contract (null on invalid) is
   unchanged.
3. **`@std/media-types` owns content types.** The hand MIME tables in
   `static-serve.ts` and in the generated self-contained `serve.mjs` are
   replaced by one source of truth: `contentTypeFor` delegates to the
   standard library, and the generator derives its pinned table from
   `contentTypeFor` at build time (the generated file itself stays
   dependency-free). Served `Content-Type` values now follow the standard
   library byte-for-byte (notably `charset=UTF-8` casing,
   `image/vnd.microsoft.icon`, bare `application/xml`).
4. **No framework HTML sanitizer; `trustedHtml` is the boundary.** The
   unaudited general-purpose `sanitizeHtml` allow-list sanitizer
   (`@openelement/element/sanitize`) is deleted: no public export, no
   internal use, no site use. Raw head fragments (`headExtras`,
   `inject.headFragments`) are developer-trusted input passed through
   verbatim; the framework enforces only the fail-closed invariants
   (no `<script>`, no executable `<style>`), and the document serializer
   keeps its sink-side script/event-handler stripping as last-resort defense.
   Site collections render first-party repository Markdown as trusted content
   (`trustCollectionHtml`); untrusted data must be sanitized at the
   consumer's system boundary before entering the framework.
5. **Ended experiments leave the tree.** `tools/experiments/{cem,oxc,ts7}`
   are deleted after their conclusions landed: CEM stays upstream-typed with
   OE admission classification in product code, the TS7 posture is owned by
   the non-blocking `gate:ts7:shadow` executable gate, and one-off evidence
   remains in `docs/evidence/` history plus Git history. Revisit only with a
   new consumer and a new decision record.

## Consequences

- Breaking: `@openelement/element/sanitize` is gone; served content-type
  bytes change as above; runtimes without `URLPattern` fail fast.
- Docs, the site security guide, generated API reference, the public
  interface snapshot, and generated site data are updated in the same change.

## Addendum (2026-09-13): generated standalone server deleted

Item 3 above kept a derived MIME table inside the generated
`dist/server/serve.mjs`. Follow-up convergence deletes that second
production server entirely: the build emits only the portable
`fetch(Request) -> Response` entry (`dist/server/index.js`), local preview
is served by the start CLI from TypeScript source (`Deno.serve` over the
shared fetch handler in `static-serve.ts`), and production deploys go
through the Nitro mount. GET/POST/loader/action/static/cache/404/error
coverage moves to the start-CLI and Nitro proof legs; no MIME table,
request dispatch, or server file is generated anymore.
