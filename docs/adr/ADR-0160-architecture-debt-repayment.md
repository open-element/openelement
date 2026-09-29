# ADR-0160: Architecture-debt repayment charter (alpha6)

- Status: ACCEPTED — alpha6 lane (2026-09-29)
- Tracking: #1467
- Preserves: ADR-0143, ADR-0148, ADR-0152, ADR-0157, ADR-0158, ADR-0159

## Decision boundary

alpha6 is a debt-repayment train: its stages restructure internal seams —
generated-entry growth, serializer forks, compiler/router coupling,
chunk-name-derived identity, release-name leakage into artifacts — without
moving product semantics. This ADR is the lane's legislation. The six rules
below bind every later stage of the lane, and the oracle suite at the end of
this document is the read-only definition of "no behavior change". This ADR
itself migrates nothing.

## Rules

a) **Generated code is route wiring only.** Codegen templates
(`packages/router/src/vite/internal/ssg/entry-codegen.ts` and siblings)
select routes, bind renderers, and forward requests. Server runtime logic
— actions, streaming pump, header channel, claim, scheduling — lives in
typecheckable TS modules (the `entry-*-runtime.ts` / `island-*.ts` family)
that generated entries import and the bundler inlines. New behavior lands
in those modules and gains a unit test; it must not accrete inside
template strings, where it is invisible to `deno check` and to the test
suite.

b) **One tree-walking serializer.** The compiled Element serializer has
exactly one implementation per walk. The server and runtime-seed
serialization paths already share one escape implementation
(`internal/core/html-escape.ts`); `compiled-escape-parity.test.ts` pins
byte parity between the call sites. A stage may not fork a second walker,
add a concatenation fallback that re-walks, or route special cases into
their own serializer.

c) **The compiler semantic core does not know Router.** The ADR-0148
layering holds: the bundler-neutral semantic core
(`packages/element/src/internal/compiler/semantic-core/`) must not import
Router types, route tables, or SSG admission policy. Where the core needs
an admission decision, the caller injects a generalized admission
descriptor — plain data with a versioned shape — and the core consumes it
without learning the caller's vocabulary. Generalizing an admission input
is repayment; growing a router-typed import in the core is not.

d) **Client asset injection is manifest-driven.** Islands, enhancer scripts,
and critical assets attach to a route through the build manifest
(`island-manifest.ts`, `client-island-entries.ts`,
`critical-assets.ts` in `packages/router/src/vite/internal/ssg/`).
Business identity — route, page, island name — is never derived from
chunk file names. Chunk names may be content hashes, but no generated or
runtime code parses them to decide what to inject.

e) **Runtime artifacts carry protocol/ABI versions, not release names.**
Generated and shipped artifacts may embed protocol identifiers (Part
Program version, registry marker wire values, error-code enums) because
consumers match on them. They must not embed historical release labels
(`1.0.0-alpha.N` and successors) as runtime-carried values: a release name
is not a protocol fact, and carrying it forces later lanes to keep
meaningless bytes stable. Source comments may cite the release that pinned
a value; artifacts do not.

f) **Output invariants.** Stages S1, S5, and S6 keep outputs byte-identical
to the pre-lane baseline: the oracle suite passes with its assertions
intact, and rendered HTML, manifests, and generated entries across the
fixtures and the site build are unchanged. Stages S3 and S4 may change
output bytes, but only for deltas pre-recorded in this ADR under
"Admitted output deltas": each entry names the stage, the artifact, the
expected difference, the reason, and the oracle evidence that protocol
semantics are unchanged. An unrecorded byte difference in S3 or S4 output
is a lane failure, not a tune-up.

The pre-lane baseline evidence (element and router suite results, site build
tree hash, framework fixture build hashes) was recorded by the lane's first
stage under `.artifacts/alpha6-baseline/`. That directory is deliberately
gitignored — it is per-checkout evidence, not a repository artifact — so the
durable enforcement of the invariants is the oracle suite below plus each
stage's recorded evidence, not the local file.

## Read-only oracle suite

During the migration these tests are read-only: their assertions may not be
weakened, skipped, or narrowed; only new cases may be added. A change to an
oracle assertion requires an amendment to this ADR naming the stage and the
reason. One exception is scheduled by design: `registry-marker-drift` is
rewritten in S3, which re-homes the wire values it pins.

| Oracle test                 | Path                                                            | Pins                                                                                                                 |
| --------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| request-time-parity         | `packages/router/__tests__/request-time-parity.test.ts`         | dev (hono) vs build (Nitro) request-time semantic parity: status codes, headers, middleware onion order              |
| compiled-escape-parity      | `packages/element/__tests__/compiled-escape-parity.test.ts`     | one shared escape implementation; server and runtime seed serializers emit byte-identical output                     |
| stream-manifest             | `packages/router/__tests__/stream-manifest.test.ts`             | route → loader field → signal → Part/Region deferral manifest (ADR-0158)                                             |
| renderer-scope-parity       | `packages/router/__tests__/renderer-scope-parity.test.ts`       | codegen-time scope predicate and the generated `__matchingRenderers` re-expression agree on every (scope, path) pair |
| lit-graph-boundary          | `packages/router/__tests__/lit-graph-boundary.test.ts`          | the generated LIT entry's real import graph never reaches the Native runtime kernel, with a negative control         |
| ssg-admission-parity        | `packages/router/__tests__/ssg-admission-parity.test.ts`        | one admission plan shared by the dev/SSR entry and the SSG entry, with matching build evidence                       |
| compiler-open-core-boundary | `packages/router/__tests__/compiler-open-core-boundary.test.ts` | the `open:core` transform carries the compiler's real Source Map v3 and its two-stage admission gate                 |

Exception: `packages/router/__tests__/registry-marker-drift.test.ts` pins the
SSR registry marker wire values and the generated artifacts that carry them;
S3 rewrites that test as part of its design.

## Verification

- The oracle suite is green, unweakened, at every stage boundary.
- S1/S5/S6: outputs byte-identical to the pre-lane baseline recorded by the
  lane's first stage.
- S3/S4: every output byte difference appears under "Admitted output deltas"
  before or with the stage that produces it.
- Rule (c) direction stays enforced by
  `packages/element/__tests__/compiler-semantic-core-boundary.test.ts` and
  the forbidden-import checks behind ADR-0148.

## Admitted output deltas

None recorded at lane start. S3 and S4 append entries here, one per artifact
difference, each with stage, artifact, expected difference, reason, and
oracle evidence.

### S3a — response/header channel becomes imported runtime (#1470 block a)

- Artifact: the generated virtual Hono server entry — every shape that
  embeds it (the dev entry, the SSG SSR bundle `dist/server/entry.js`, and
  the request-time `dist/server/index.js` bundle).
- Expected difference: the emitted `__PROTOCOL_HEADERS` constant and the
  `__mergeChannelHeaders` function body (entry-render-runtime.ts) and the
  `__streamHeaderChannel` Proxy body (entry-stream-runtime.ts) are gone; the
  entry imports them from the new `@openelement/router/server-runtime`
  subpath and keeps only call sites. The CSP auto-nonce middleware emission
  replaces inline `crypto.randomUUID().replace(/-/g, '')` and
  `.replace('NONCE_PLACEHOLDER', nonce)` with `__cspCreateNonce()` /
  `__cspApplyNonce(<template>, nonce)` calls into the same module. Byte
  evidence at the renderer-adapter.test.ts pin: native server entry
  27507 → 27032 bytes, lit server entry 25562 → 25087 bytes; client entries
  unchanged (1983 / 3138 bytes).
- Reason: ADR-0160 rule (a) — header commitment, the late-mutation Proxy
  gate, Set-Cookie merge, protocol-header precedence, and the CSP nonce are
  server runtime semantics and must live in typecheckable, unit-testable TS
  modules, not inside template strings.
- Impact: the new subpath is a declared export (`packages/router/deno.json`),
  so the derived generated artifacts regenerate by ritual:
  `generated-export-files.ts` and
  `docs/release/public-interface-snapshot.json` gain the `./server-runtime`
  entry (6 public symbols, all documented). The string-eval harnesses in
  `packages/router/__tests__` (`new Function` / data:-URL evaluation) cannot
  carry import declarations, so they bind the real module implementations
  through their evaluation context (stream-handler.test.ts injects them via
  `deps`) — no harness-local reimplementation exists; the only serialized
  copies kept in generated code remain the pre-existing data lists
  (`__DANGEROUS_KEYS`, `__ssrRenderableTags`) that exist because packed
  consumer setups cannot import Element at all.
- Oracle evidence: `request-time-parity.test.ts` green on all 29 steps for
  both runtimes against the rebuilt fixture — including the ADR-0129 step
  (GET channel header present, protocol `Cache-Control` wins over the
  channel, `Set-Cookie` survives the 303 redirect, the 422 re-render carries
  the action's channel entry); `stream-manifest`, `renderer-scope-parity`,
  `ssg-admission-parity`, `lit-graph-boundary` (the walk resolves the new
  subpath and confirms it stays kernel-free), and `compiler-open-core-
  boundary` all green with assertions intact; `stream-handler.test.ts`
  drives the real generated handler against the typed module (15 tests,
  including protocol precedence and the post-commit late-write gate).

### S3b — page/document/render runtime becomes imported modules (#1470 block b)

- Artifact: the generated virtual Hono server entry — every shape that
  embeds it (the dev entry, the SSG SSR bundle, and the request-time server
  bundle).
- Expected difference: the emitted helper function bodies of the old
  entry-render-runtime.ts are gone from the entry — `__ssr` (native
  renderDsd fork and lit renderLitPageToHtml fork), `__resolvePageTag`
  (compiled-program fork and lit openElementPageTag fork),
  `__filterPageProps`/`__defaultPageProps`/`__pageProps`/`__pageErrorProps`,
  `__pageDefinition`/`__routeMeta`, `__localeFromPath`,
  `__localizeShellHref`, `__statusHtml`, `__resolveAppShell`, and
  `__renderAppShell` now live in the `@openelement/router/server-runtime`
  modules (page-render.ts, renderer-runtime.ts, document-runtime.ts) and the
  entry keeps the renderer-adapter-selected imports plus one-time factory
  bindings that wire them to its serialized build data. The data lists stay
  serialized in the entry by design (packed consumer setups cannot import
  Element at all, and generated code cannot import Element internals):
  `__ssrRenderableTags`, `__DANGEROUS_KEYS`, `__appShellPlan`, `__locales`,
  `__navSections`, `__headerNav`, `__getDefaultLocale`. `__localeFromPath`
  gained the locales argument at its one call site (the page-context
  builder); `__createDeferredPageShell` moved emitter-to-emitter into the
  stream runtime emission (entry-stream-runtime.ts) with its text unchanged —
  it is stream machinery, only called by streamed routes, and the
  stream-manifest oracle pins its emitted shape, so its typed migration
  belongs to the streaming-pump block together with that oracle. Helpers are
  now gated on page routes existing (API-only entries stop carrying them).
  Byte evidence at the renderer-adapter.test.ts pin: native server entry
  27032 → 22783 bytes, lit server entry 25087 → 22323 bytes; client entries
  unchanged (1983 / 3138 bytes, still at the pre-lane baseline).
- Reason: ADR-0160 rule (a) — the page SSR render seam, the props projection
  with its dangerous-key guard, the app-shell composition, tag resolution,
  locale resolution, and status pages are server runtime semantics and must
  live in typecheckable, unit-testable TS modules, not inside template
  strings. The native/lit fork keeps its renderer-adapter seam shape: the
  adapter selects which factory and tag resolver the entry imports, and the
  emitted call sites are renderer-neutral.
- Impact: the server-runtime subpath grows from 6 to 22 public symbols
  (ritual regeneration of `docs/release/public-interface-snapshot.json`;
  `./server-runtime` was already a declared export). The string-eval
  harnesses in `packages/router/__tests__` that used to eval the emitted
  helper bodies (data:-URL modules cannot resolve imports) now call the
  shipped modules directly; stream-handler.test.ts binds the real module
  implementations through its evaluation context as in S3a and now executes
  the real emitted `__createDeferredPageShell` text. The typed modules carry
  no `@openelement/element` import edge — the entry injects renderDsd,
  trustedHtml, escapeHtml, the registry, and renderLitPageToHtml at binding
  time — so the LIT entry's import graph stays kernel-free.
- Oracle evidence: `request-time-parity.test.ts` green on all 29 steps for
  both runtimes against the rebuilt fixture (the fixture build exercises the
  new factory wiring end to end, including the app-shell composition, the
  error-boundary re-render, and the styled 404); `stream-manifest` green
  unmodified (its two emitted-shape assertions hold); `renderer-scope-parity`,
  `ssg-admission-parity`, `lit-graph-boundary` (walk stays kernel-free),
  `compiler-open-core-boundary`, `registry-marker-drift`,
  `compiled-escape-parity` all green with assertions intact.

### S3c — the action POST protocol becomes an imported runtime (#1470 block c)

- Artifact: the generated virtual Hono server entry — every shape that
  embeds it (the dev entry, the SSG SSR bundle `dist/server/entry.js`, and
  the request-time `dist/server/index.js` bundle).
- Expected difference: the emitted `__runActionProtocol` function body, the
  `__bodyLimit({ maxSize: 10 * 1024 * 1024, onError: … })` options emission
  (413 problem+json fork and text fallback), the POST catch-branch bodies
  (the ADR-0121 303 coercion with its fetch ActionResult redirect, and the
  RFC 9457 500 mapping), the `problemJsonLine` helper, and the
  `__honoContexts`/`__asFetchHandler`/`__asFetchMiddleware` bridge
  definitions are gone from the entry. It now imports `runActionProtocol`,
  `createActionBodyLimit`, `actionRedirectResponse`, `actionErrorResponse`,
  `createHonoBridge`, and `ACTION_FETCH_HEADER` from
  `@openelement/router/server-runtime` and keeps only call sites and one-time
  bindings (`const __actionBodyLimit = __createActionBodyLimit(__maxActionBodyBytes);`,
  the bridge destructuring). The `@openelement/router` import shrinks to the
  two lifecycle guards; the `hono/body-limit` import and the
  `classifyActionResult`/`PROBLEM_JSON_MEDIA_TYPE` names no longer appear in
  the entry. One new serialized data line: `__maxActionBodyBytes`, derived
  from the S1c policy constant. Byte evidence at the renderer-adapter.test.ts
  pin: native server entry 22783 → 17478 bytes, lit server entry
  22323 → 17018 bytes; client entries unchanged (1983 / 3138 bytes, still at
  the pre-lane baseline).
- Reason: ADR-0160 rule (a) — the CSRF floor, named-action dispatch,
  classification, the problem+json error channel, PRG, the body limit, the
  redirect coercion, the 500 error mapping, and the internal
  Hono↔WinterCG bridge are server runtime semantics and must live in
  typecheckable, unit-testable TS modules, not inside template strings.
- Impact: the server-runtime subpath grows from 22 to 34 public symbols
  (ritual regeneration of `docs/release/public-interface-snapshot.json`;
  `./server-runtime` was already a declared export, so
  `generated-export-files.ts` needed no change). One serialized copy is kept
  by design: the body-limit NUMBER stays build data in the entry because
  `MAX_ACTION_BODY_BYTES` lives behind the Element runtime facade
  (`public-runtime.ts`), which the LIT kernel-free graph and packed consumer
  setups cannot import — the same reason as `__DANGEROUS_KEYS`; the copy is
  derived from the build-time import, so changing the canonical value
  re-derives it (entry-renderer.test.ts pins the derivation, not a literal).
  The protocol CONSTANTS (`ACTION_FETCH_HEADER`, `PROBLEM_JSON_MEDIA_TYPE`,
  `classifyActionResult`) travel as real imports of the kernel-free
  authoring leaves — no copies. The string-eval harness in
  stream-handler.test.ts binds the real bridge, body-limit factory, policy
  constant, and fetch header through its evaluation context (as in S3a) —
  no harness-local reimplementation remains; the deleted harness-local stubs
  (`__bodyLimit`, the literal `__actionFetchHeader`,
  `__problemJsonMediaType`) are the "rest" this block removed. The
  ADR-0120/0121 entry-renderer pins became wiring pins (import bindings,
  middleware composition, action-before-loader order, `import.meta.env.PROD`
  staying at the call site) and the protocol semantics moved to behavior
  assertions: the new `server-runtime-action-runtime.test.ts` suite (22
  tests) drives the shipped module for CSRF (#611/#921/#938/#1382), the
  own-key gate (#542), the fail/PRG channels (#548), problem+json (#863),
  the 413 fork (#568), the 303 coercion, the 500 scrubbing (#558), and the
  bridge.
- Oracle evidence: `request-time-parity.test.ts` green on all 29 steps for
  both runtimes against the rebuilt fixture — and it caught a real wire
  divergence during migration (the migrated catch-branch fetch redirect
  initially answered HTTP 303 because the helper passed the status as
  `c.json`'s second argument, where the emitted original answered HTTP 200
  with the 303 in the ActionResult body; fixed and pinned by the behavior
  suite before landing). `stream-manifest`, `renderer-scope-parity`,
  `ssg-admission-parity`, `lit-graph-boundary` (the walk resolves the new
  action module and confirms the LIT graph stays kernel-free),
  `compiler-open-core-boundary`, `registry-marker-drift`, and
  `compiled-escape-parity` all green with assertions intact;
  `stream-handler.test.ts` drives the real generated GET handler through the
  real bridge (15 tests, unchanged assertions).
