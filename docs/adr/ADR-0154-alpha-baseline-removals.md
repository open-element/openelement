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
   is removed from the tree (recoverable from Git history). Revisit only
   with a new consumer and a new decision record.

## Consequences

- Breaking: `@openelement/element/sanitize` is gone; served content-type
  bytes change as above; runtimes without `URLPattern` fail fast.
- Docs, the site security guide, generated API reference, the public
  interface snapshot, and generated site data are updated in the same change.

## Amendment (2026-09-14): JSONC and content-type ownership reverted to maintained npm packages

Items 2 and 3 above are superseded. The `@std/jsonc` / `@std/media-types`
choice forced an `npm:@jsr/*` bridge into shipped Router tooling and the packed
tarball, which the Alpha dependency rule (Web Standards, then Deno/`@std`,
then mature third party; no bridge in shipped output) does not justify. The
config reader now uses the mature zero-dependency `jsonc-parser` npm package
(`packages/router/src/vite/internal/jsonc.ts`) and static serving uses `mime`
(`packages/router/src/vite/internal/static-serve.ts`). The contracts those
items fixed (null on invalid JSONC; `charset=UTF-8` casing,
`image/vnd.microsoft.icon`, bare `application/xml`) are preserved and pinned
by `packages/router/__tests__/static-serve.test.ts`.

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

## Amendment (2026-09-16): raw-head channels enumerated; route-resolved fragments now guarded

The §4 statement above named two raw head channels (`headExtras`,
`inject.headFragments`) and claimed the document serializer keeps sink-side
stripping as last-resort defense. Two corrections, landed post-merge of #1353:

1. A third raw channel exists and is the only one reachable from request data:
   `PageHead.dangerouslyHeadFragments` resolves through
   `resolvePageDocument` with `{ data, actionData, params, request, route }`.
   It now receives the same two fail-closed predicates as the config-time
   channels — `assertNoScriptTags` and `assertTrustedHeadHtml`
   (`packages/router/src/document.ts`) — rejecting `<script>` and blacklisted
   `<style>` at resolution time for both static and resolver heads.
2. The "last-resort defense" clause is precise only when
   `allowHeadExtrasScripts` is false; when `inject` is configured, the
   document serializer's script/event-handler stripping is disabled by design
   (`html-escape.ts`), and enforcement lives entirely in the two predicates
   above plus URL validation on `inject.scripts`.

## Amendment (2026-09-17): structured data (JSON-LD) is a data channel, not a fourth raw channel

The channel taxonomy above is complete for _raw_ markup; structured data now
has a channel of its own, deliberately outside that enumeration:

1. `PageHead.structuredData` (`packages/router/src/authoring.ts`) resolves
   through the same Document seam (ADR-0153 §1) into
   `ResolvedDocument.structuredData`. `resolvePageDocument` fails closed on
   anything JSON cannot represent — a string entry, a function- or
   `undefined`-valued property, `NaN`/`Infinity`, a `Date`/`Map`/`Set`/class
   instance, a circular reference — and normalizes the survivors into a
   null-prototype copy (`packages/router/src/document.ts`). Callers hand the
   framework DATA; there is no path from this field to markup.
2. The single serialization point is `wrapInDocument`
   (`packages/element/src/internal/core/html-escape.ts`): one
   `<script type="application/ld+json">` per document in `<head>`, body =
   `JSON.stringify` output with every `<` escaped as `\u003C`, so a payload can
   neither close the element early nor open an HTML comment; a valid CSP nonce
   reaches the tag like every other framework-generated script.
3. The `<script>` ban on the raw channels is UNCHANGED: `assertNoScriptTags`
   still rejects a well-formed `application/ld+json` string passed through
   `dangerouslyHeadFragments` — the string form is a fail-closed error on the
   data channel too, so the two cannot be confused
   (`packages/router/__tests__/document.test.ts`).

Frozen paths touched: `authoring.ts` (§1) gains the field;
`packages/router/src/vite/internal/ssg/entry-route-helpers.ts` feeds
`__doc.structuredData` into the shared `wrapInDocument` option block used by
both the request-time handlers and the SSG render route; the public interface
snapshot is regenerated. First consumer: the product site emits `BlogPosting`
on blog dispatches and `WebSite` + `Organization` on the front page, from site
truth only (no invented logo, `sameAs`, or social profiles).
