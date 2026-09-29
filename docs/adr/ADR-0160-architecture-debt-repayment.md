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

## Amendment 1 — the deferred-shell gate becomes imported runtime (2026-09-29)

- Amends: the read-only `stream-manifest` oracle's two emitted-shape
  assertions and the `generated-entry-gate` function allowlist (both as
  recorded in the S3d/S3e entries below).
- Motivation: `__createDeferredPageShell` was the lane's last runtime
  function body emitted into a generated entry — the one carve-out S3d kept
  "with the oracle" (the read-only stream-manifest pin held its emitted text
  byte-exact, so migrating it required this amendment first). It is stream
  machinery like the pump it serves; rule (a) has no remaining reason to
  exempt it, and the pin that kept it emitted is exactly what kept its body
  invisible to `deno check` and to direct unit tests.
- Assertion before: `stream-manifest.test.ts` asserted the generated entry
  EMITS `async function __createDeferredPageShell(` and the literal
  `return createDeferredDsdExecutor({ componentClass: Cls, props, manifest, instanceId, documentToken });`
  line; `generated-entry-gate.test.ts` allowlisted that one name in the
  request-time section (`REQUEST_TIME_ALLOWED`).
- Assertion after (equal or stronger): `stream-manifest.test.ts` asserts the
  entry IMPORTS the typed factory (`createDeferredPageShell as
  __createDeferredPageShellGate` from `@openelement/router/server-runtime`),
  binds it (`const __createDeferredPageShell = __createDeferredPageShellGate({
  streamManifests: __streamManifests, createDeferredDsdExecutor });`), and
  keeps the `await __createDeferredPageShell(` call site;
  `generated-entry-gate.test.ts` allows ZERO request-time function
  declarations — streamed entry shapes are now among the gated descriptors —
  and adds the emitted head to the retired list. The fail-closed contract the
  emitted text used to carry is pinned as behavior on the typed module
  (`server-runtime-stream-runtime.test.ts`: missing manifest, program
  tag/version mismatch, uncompiled class, and the exact delegation of
  `{ componentClass, props, manifest, instanceId, documentToken }`);
  `stream-handler.test.ts` binds the real factory through its evaluation
  context and still drives the gate through the real generated handler.
- Equivalence: the gate's semantics are unchanged — same fail-closed
  condition, same error text, same executor delegation — so protocol behavior
  is identical; only the carrying artifact changes (emitted text → bundled
  typed module that the bundler inlines as before). The emptied emitter
  (`entry-stream-runtime.ts`) is deleted; the server-runtime subpath grows by
  the factory and its config type (ritual regeneration of
  `docs/release/public-interface-snapshot.json`; `./server-runtime` was
  already a declared export).

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

### S3d — the streaming pump becomes an imported runtime (#1470 block d)

- Artifact: the generated virtual Hono server entry — every shape that
  embeds it (the dev entry, the SSG SSR bundle `dist/server/entry.js`, and
  the request-time `dist/server/index.js` bundle) — for entries with an
  admitted stream route; plus the `@openelement/element/authoring` export
  surface and the derived `docs/release/public-interface-snapshot.json`.
- Expected difference: the emitted streaming-pump bodies are gone from the
  entry — `__streamRequestScope` (abort fan-out/cancel), `__streamJson`
  (the 256 KiB-bounded escaping encoder), `__streamObserveThenables`,
  `__streamFields` (the 32/64 front gate), `__streamBody` (shell commitment
  with the typed seed attribute, the bounded wake/queue behind
  `highWaterMark: 0`, the 30 s timeout sweep, Part backfill frames,
  terminal error frames, the no-JS tail), and the ~14 kB
  `__streamBrowserBootstrap` literal. The entry imports
  `createStreamRequestScope`, `streamFields`, `createStreamBody`, and
  `STREAM_BROWSER_BOOTSTRAP` from `@openelement/router/server-runtime`,
  binds `const __streamBody = __createStreamBody({ escapeAttr });`, and
  passes the bootstrap constant (not a call result) to
  `documentStreamParts`; the bundler still inlines the pump and the
  bootstrap into every bundled entry, and the bootstrap stays an inline head
  script per streamed page (S4 re-homes it). The bare literals 262144, 32,
  64, and the timeout now reference the policy constants. Byte evidence at
  the renderer-adapter.test.ts pin: UNCHANGED (native server 17478, lit
  server 17018, clients 1983/3138) — the pinned descriptors have no stream
  routes, and every emission change is stream-gated; streamed entries drop
  the pump bodies and the duplicated bootstrap literal. The
  `__createDeferredPageShell` emission is byte-identical to the pre-block
  text (verified by a pre/post diff of the emitter output; the bootstrap
  string is byte-identical too, 14039 chars).
- Reason: ADR-0160 rule (a) — the request scope, the deferred-field front
  gate with its rejection-observation sweep, the bounded queue,
  cancellation/timeout, the frame formats, and the browser installer are
  server runtime semantics and must live in typecheckable, unit-testable TS
  modules, not inside template strings. This is also the "separate
  convergence pass" S1c scheduled for the generated-string copies of the
  policy constants.
- Impact: the server-runtime subpath grows from 34 to 44 public symbols and
  `@openelement/element/authoring` gains the nine stream policy/frame
  constants (`STREAM_MAX_FIELDS`, `STREAM_MAX_OWNERS`,
  `STREAM_MAX_SEED_PROPERTIES`, `STREAM_MAX_PAYLOAD_LENGTH`,
  `STREAM_TIMEOUT_MS`, `STREAM_FRAME_FORBIDDEN_TAGS`,
  `STREAM_FRAME_UNSAFE_URL`, `STREAM_FRAME_URL_ATTRIBUTES`,
  `STREAM_FRAME_URL_CONTROL_MAX`) — ritual regeneration of
  `docs/release/public-interface-snapshot.json` for both packages. The
  constants ride the kernel-free `/authoring` leaf (same transport as the
  action protocol constants in S3c), so the typed module imports them as
  real values with no Element-runtime edge and the LIT graph stays
  kernel-free. One serialized copy is kept BY DESIGN in generated code: the
  `__createDeferredPageShell` gate stays emitted (entry-stream-runtime.ts
  shrinks to that one emitter) because the read-only stream-manifest oracle
  pins its emitted shape (`stream-manifest.test.ts`: the function head and
  the `createDeferredDsdExecutor(...)` return line); migrating it requires
  an oracle amendment, so the block-b hand-off note resolves to "kept, with
  the oracle" for this lane. The string-eval harness in
  stream-handler.test.ts binds the real module functions through its
  evaluation context (as in S3a) — no harness-local reimplementation; the
  deleted pump emission was the "rest" this block removed.
  `stream-browser.test.ts` now imports the bootstrap constant from the
  typed module and still executes the byte-identical string in real
  Chromium. A new `server-runtime-stream-runtime.test.ts` suite (13 tests)
  drives the typed module directly: the scope fan-out/cancel contract, the
  front-gate rejections and their observation sweep, the policy bounds
  (field budget, oversized range → error frames), the shell commitment, the
  terminal error frame, the timeout sweep, and the bootstrap's policy
  interpolation.
- Oracle evidence: `stream-manifest` green unmodified (13 tests — its two
  emitted-shape assertions hold byte for byte); `request-time-parity` green
  on all 29 steps for both runtimes against the rebuilt fixture;
  `lit-graph-boundary` green (the walk resolves the new stream module
  through the subpath's `/authoring` edge and the LIT graph stays
  kernel-free, negative control intact); `renderer-scope-parity`,
  `ssg-admission-parity`, `compiler-open-core-boundary`,
  `registry-marker-drift`, and `compiled-escape-parity` all green with
  assertions intact; `renderer-adapter.test.ts` byte pins unchanged;
  `stream-handler.test.ts` green (15 tests, unchanged assertions) with the
  real pump bound through deps; `stream-browser.test.ts` green (7 tests,
  real Chromium against the byte-identical bootstrap).

### S3e — the generated entry is reduced to route wiring (#1470 block e)

- Artifact: the generated virtual Hono server entry — every shape that
  embeds it (the dev entry, the SSG SSR bundle `dist/server/entry.js`, and
  the request-time `dist/server/index.js` bundle); plus the
  `@openelement/element/authoring` export surface (one constant), the
  derived `docs/release/public-interface-snapshot.json`, and the
  `registry-marker-drift` oracle (rewritten by design — the lane's one
  scheduled exception).
- Expected difference: the entry's final form is imports + route-descriptor
  data + one `createGeneratedApp({...})` factory call + per-route wiring.
  The emitted assembly is gone: `const app = new Hono()` and the
  `createHonoBridge()` destructure (now the factory's `hono` bridge), the
  `__openElementFetchMiddleware`/`composeFetchMiddleware` handler
  composition and the `openElementDevFetch`/`openElementRuntimeAdapter`
  export literals (factory-composed, re-exported as `__app.handler` /
  `__app.devFetch` / `__app.runtimeAdapter`), the `__setRequestTimeClientScript`
  setter body and `__clientScriptDescriptors` factory (#951 plumbing moved
  into the factory; the entry keeps the `import.meta.env` dev-URL literal at
  the `devClientScriptSrc` config property and re-exports the setter), the
  `__registerSsrComponent`/`__entryDefined` registry wrapper and the
  injected marker literals (the typed `security.ts` guard imports the
  canonical constants; the entry keeps only the register call sites), the
  `__assertStreamRoute`/`__assertLitStreamRoute` function bodies and the
  405 `methodNotAllowed` closure (typed `route-dispatch.ts`; the entry keeps
  the per-route assertion call sites), the `Object.fromEntries` page-handler
  table, and the `createLogger`/`log` binding (dead in every generated
  entry). The `__createRouteMiddleware` import, the `app.all('*')` request
  hook, and the emitted per-route GET/POST/404 wiring are byte-identical to
  block d (verified: the dispatch composition still follows the
  page/action emissions — createRouteMiddleware reads each handler record at
  call time). Serialized-copy deletion: `__DANGEROUS_KEYS` and
  `__maxActionBodyBytes` are gone — the factory imports
  `DANGEROUS_KEYS` and `MAX_ACTION_BODY_BYTES` from the kernel-free
  `/authoring` leaf (which gained `MAX_ACTION_BODY_BYTES`; it already rode
  that leaf's `internal/protocol/policy.ts` home) and binds the props
  projection and the body-limit middleware itself. `__ssrRenderableTags`,
  the shell plan, locales, and the island map stay serialized build data
  (they are per-project descriptor values with no importable source), now
  as factory-config properties instead of standalone consts. Byte evidence
  at the renderer-adapter.test.ts pin: native server entry 17478 → 14141
  bytes, lit server entry 17018 → 14254 bytes; client entries UNCHANGED
  (1983 / 3138 bytes, still at the pre-lane baseline).
- Reason: ADR-0160 rule (a) — app assembly, dispatch, registration
  security, client-script plumbing, and the handler-export contract are
  server runtime semantics and must live in typecheckable, unit-testable TS
  modules, not inside template strings. This block also lands the two
  remaining items of the S3a verdict: the only consumer setup that cannot
  import Element is the repo's own string-eval test harness (data:-URL /
  `new Function` evaluation cannot carry imports), and those harnesses bind
  implementations through their evaluation context (`deps`) — as recorded
  in S3a-d — so no product setup needs the serialized copies and both are
  deleted; the harness accommodation (deps bindings, not copies) is the
  recorded exit condition, and it retires only if a packed-consumer setup
  that cannot resolve the bundler-inlined import ever appears.
- Impact: the server-runtime subpath grows from 44 to 55 public symbols
  (`createGeneratedApp` + types, the dispatch guards/table/405 responder,
  the registry guard, and the re-exported `DANGEROUS_KEYS`) and
  `@openelement/element/authoring` gains `MAX_ACTION_BODY_BYTES` (ritual
  regeneration of `docs/release/public-interface-snapshot.json` for both
  packages; `./server-runtime` was already a declared export). The factory
  imports only kernel-free leaves (hono, element/logger, element/build-utils,
  element/authoring, router/http) — the LIT entry's import graph stays
  kernel-free (lit-graph-boundary walks the new factory edge). The
  `registry-marker-drift` oracle is rewritten per the lane's design
  exception: the wire values and the polyfill-banner pin stay byte-exact;
  the "generated entry injects every canonical marker" pin becomes
  "the entry carries neither the markers nor customElements surgery — only
  the factory-bound register call sites", plus new guard behavior cases
  (single wrapper install with the TRUE original kept on the registry, stub
  registry re-definition wins with ownership tracking, dev re-evaluation
  overwrites its OWN tag through the original define, foreign
  registrations fail closed). `entry-renderer.test.ts` /
  `entry-descriptor.test.ts` / `lit-renderer-codegen.test.ts` pins whose
  subject moved into the factory became factory-config pins; the pins whose
  subject is unchanged wiring (handler emissions, call sites, exports)
  are untouched. New `generated-entry-gate.test.ts` hard gates: (a) every
  generated shape parses with zero TypeScript syntax diagnostics
  (transpileModule with reportDiagnostics — the bundler-facing deno-check
  floor); (b) every emitted function declaration is allowlisted (only the
  oracle-pinned `__createDeferredPageShell` in the request-time section and
  the four SSG prerender-section functions) and 27 retired emission heads
  can never reappear; (c) no `__DANGEROUS_KEYS` and no serialized canonical
  key literal; (d) a real static import walk from the generated client
  entry and the browser runtime modules (island-scheduler.ts,
  enhance-client.ts behind `virtual:open-client-runtime`) never reaches
  `server-runtime/`, with a negative control from the server entry. The
  stream-manifest oracle's `__assertStreamRoute` harness now executes the
  shipped typed guard directly (the emitted-helper extraction could not
  carry imports) — its assertions (call-site text, rejection messages,
  field/file naming) are unchanged; the deferred-shell pins it also carries
  were left byte-exact per S3d.
- Oracle evidence: `request-time-parity` green on all 29 steps for both
  runtimes against the rebuilt fixture (it caught the one real migration
  bug: an intermediate revision emitted the dispatch composition before the
  page-handler population, and the built bundle failed SSG rendering with
  `No handlers for /` — fixed by restoring the pre-block emission order);
  `stream-manifest` (13 tests, deferred-shell pins byte-exact),
  `renderer-scope-parity`, `ssg-admission-parity`, `lit-graph-boundary`
  (the walk resolves the factory and stays kernel-free, negative control
  intact), `compiler-open-core-boundary`, and `compiled-escape-parity` all
  green with assertions intact; the full `packages/router/__tests__` batch
  (929 tests) and `packages/element/__tests__` batch (426 tests) green;
  `generate:all` and `interface:snapshot:write` rituals run clean;
  `stream-handler.test.ts` green (15 tests, unchanged assertions — its deps
  harness already bound the implementations the emitted call sites
  reference).

### S4 — the idle-hydration fallback timeout becomes the policy constant

- Artifact: the generated client entry — every shape that embeds it (the
  Vite-built client bundle in dev and prod, native and lit).
- Expected difference: the `__schedule({...})` deps gain one line,
  `idleFallbackTimeoutMs: 50` (the serialized build-time value of Element's
  `IDLE_FALLBACK_TIMEOUT_MS` policy constant; the provenance lives in the
  scheduler's deps JSDoc and a derivation pin, not in emitted comments), and
  `island-scheduler.ts`'s bare `50` in the
  `requestIdleCallback || requestAnimationFrame || setTimeout` fallback is
  gone — the import-free scheduler reads the injected dep. Byte evidence at
  the renderer-adapter.test.ts pin: native client 1983 → 2012 bytes, lit
  client 3138 → 3167 bytes; server entries unchanged (14141 / 14254); the
  #868 wiring budget (2048 B) still holds.
- Reason: S1c named the constant but left one emission site reading a bare
  literal; the scheduler's import-free constraint (it bundles into any
  consumer build unchanged, #868) rules out a direct import, so the value
  rides the same build-time-serialization seam as the #1470-block-c
  `__maxActionBodyBytes` derivation — the canonical constant in
  `internal/protocol/policy.ts` stays the single source.
- Oracle evidence: `island-scheduler.test.ts` pins the fallback behavior
  (the injected timeout reaches `setTimeout` when neither idle API exists)
  and the generated entry emission is byte-pinned by
  `renderer-adapter.test.ts`; no protocol semantics change (the number is
  identical; only its carriage changes).

### S4a — the client asset manifest and the client-before-SSG build order (#1471 items 1/2/5)

- Artifact: the request-time artifacts of every built project tree — the
  generated `dist/server/index.js` module and its companion data module
  (`dist/server/client-script.js` → `dist/server/client-assets.js`).
- Expected difference: the generated `index.js` imports `clientAssets` from
  `./client-assets.js` and calls
  `__setRequestTimeClientScript(clientAssets.entry)` (previously it imported
  `clientScriptSrc` from `./client-script.js`); the companion module now
  carries the structured client asset manifest (`{ entry, islands: Record<tag,
  { file, strategy, preload? }>, shared[] }`) instead of a single URL string.
  Everything else in every output tree is unchanged: rendered HTML, client
  chunks, island manifests, and the generated server entry
  (`dist/server/entry.js`) are byte-identical (verified by full-tree diff of
  the `router-native-framework`, `router-lit-framework`, and
  `router-request-time` fixture rebuilds against their pre-change builds).
- Reason: rule (d) — client asset injection is manifest-driven. The new
  manifest (`vite/internal/protocol/client-assets.ts`, built by
  `vite/client-asset-manifest.ts` inside the Phase 2 client build) keys
  islands by compile-time identity (delivery tag) joined with the Vite build
  manifest (`dist/client/.vite/manifest.json`) and Rollup output module
  metadata — a chunk is matched by the module ids it contains, so islands
  that share a chunk keep their identity and no code parses output chunk
  file names. `closeBundle` now runs Phase 1 SSR → Phase 2 client → Phase 3
  SSG: the SSG render pass and the request-time artifact carry the final
  asset addresses. SSG consumes exactly its pre-reorder Phase 1 facts —
  closeBundle snapshots the island declarations before Phase 2 narrows them
  to the reachable client set. The rendered-HTML script injection stays a
  post-Phase-3 step until the S4 document-renderer item; HTML bytes do not
  move. The build-context gains the internal `clientAssetManifest` slot
  (not a declared export; the public-interface snapshot is unchanged), and
  build.ts's `readClientEntryFromManifest` is retired with its test — its
  entry lookup lives on as `findClientEntryFile` in the new module, covered
  by `client-asset-manifest.test.ts`.
- Oracle evidence: `request-time-parity` green on all 29 steps against the
  rebuilt fixture (the generated `index.js` drives the same request-time
  protocol through the manifest's `entry`); `stream-manifest`,
  `renderer-scope-parity`, `ssg-admission-parity`, `lit-graph-boundary`,
  and the `generated-entry-gate` all green with assertions intact, and the
  `renderer-adapter.test.ts` byte pins (14141/14254 server, 2012/3167
  client) hold — no generated-entry bytes moved.

### S4b — client script injection becomes document-time rendering (#1471 items 3/4/6)

- Artifact: every HTML document the framework renders (SSG prerendered
  pages and request-time pages, native and lit), the generated server
  entry, the SSG post-processing pass, and the derived
  `docs/release/public-interface-snapshot.json` (`./document` and `./vite`
  shapes).
- Expected difference: (1) generated server entries move once — native
  14141 → 14249 bytes, lit 14254 → 14362 bytes — because the emitted
  document-resolution call sites pass the factory's client-script
  descriptors (`__resolvePageDocument(…, __clientScriptDescriptors())`)
  and every document wrap reads `scripts: __doc.clientScripts || []`
  instead of the request-time-only `scripts: __clientScriptDescriptors()`
  line; client entry bytes are unchanged (2012/3167). (2) A prerendered
  page with a client bundle now ends
  `…\n  <script type="module" src="…"></script>\n</body>\n</html>` — the
  tag is serialized by wrapInDocument at render time, and the empty
  placeholder line the retired post-build injector used to splice in front
  of the tag (`…\n  \n  <script …>`) is gone. (3) Static HTML files in the
  output tree that the framework did not render (files copied from
  `public/`) no longer receive a script tag: the injector rewrote every
  `*.html` it found, while document-time injection only attaches to
  rendered documents. Rendered-page coverage is unchanged (status
  redirect/not-found stubs are never persisted as pages). (4) Request-time
  HTML is byte-identical — the same descriptor list flows through the same
  serializer channel. (5) The per-page island manifests and
  `dist/server/client-assets.js` keep their shapes; the island manifests
  now read chunk URLs from the manifest's delivery-tag-keyed record.
- Reason: rule (d) — client asset injection is manifest-driven. The chunk ↔
  tag trade ran through `postprocess.ts`'s manifest-`name` matching plus a
  filename-prefix fallback (`matchIslandChunkFile`), and the script tag was
  spliced into every HTML file after the build (`injectClientScript`) —
  both derive injection from output artifacts instead of identity. The
  client asset manifest (S4a) already joins compile-time island identity
  with the Phase 2 build outputs, and the client-before-SSG build order
  makes the final addresses available at render time, so the document
  renderer is the injection point: `ResolvedDocument` carries the
  structured `clientScripts` descriptors (src/type; the loading strategy
  stays build data in the island manifests, and the CSP nonce attaches
  exactly once at serialization — request-time pages carry the per-request
  nonce, SSG output carries none, and the SSG CSP injector still rejects
  the nonce option), the build hands the manifest's entry URL to the SSR
  bundle before prerendering (the same `__setRequestTimeClientScript` seam
  the request-time server entry calls at startup), and
  `matchIslandChunkFile`/`injectClientScript`/`buildIslandChunkMap` are
  deleted. Island chunk resolution survives as
  `islandChunkMapFromAssetManifest` (identity-keyed; an unrecorded island
  is surfaced, never silently mapped).
- Impact: `@openelement/router/document` grows the public
  `ClientScriptDescriptor` type, `ResolvedDocument.clientScripts`, and the
  optional third `clientScripts` parameter of `resolvePageDocument`
  (validated fail-closed like every other head field; an empty list keeps
  the document shape byte-equal to the pre-#1471 contract), and
  regeneration of `docs/release/public-interface-snapshot.json` also
  records `OpenElementBuildContext.clientAssetManifest` on `./vite` — the
  S4a slot whose entry had declared the snapshot unchanged. The string-eval
  harnesses bind the widened seam through their evaluation contexts
  (entry-render-ssg.test.ts, stream-handler.test.ts) with no
  harness-local reimplementation; `ssg-postprocess.test.ts` and
  `ssg-integration.test.ts` are rewritten to the new contract (script
  presence and position at render time, island identity through the
  manifest, no post-build HTML surgery), and the new
  `ssg-asset-manifest.test.ts` pins the nine-scenario matrix — chunk hash
  change, chunk file rename (Rolldown default and manualChunks naming),
  manualChunks off, a new shared chunk, entry-chunk fallback, islands
  sharing a chunk, native, lit, and enhanced-forms-only with zero islands —
  proving identity never drifts with a file name.
- Oracle evidence: the full `packages/router/__tests__` batch green (945
  tests, 0 failed) including the read-only oracles with assertions intact —
  `request-time-parity` (all 29 steps), `stream-manifest`,
  `renderer-scope-parity`, `lit-graph-boundary`, `ssg-admission-parity`,
  `compiler-open-core-boundary`, `generated-entry-gate`,
  `registry-marker-drift` (run as one targeted batch: 37 passed, 29 steps)
  and `compiled-escape-parity` (7 passed); the regenerated
  `renderer-adapter.test.ts` byte pins hold at 14249/14362 server,
  2012/3167 client; the `router-native-framework` and
  `router-lit-framework` fixture builds complete end to end with the
  manifest-driven tag rendered immediately before `</body>`, per-page
  island manifests written from the manifest record, and no nonce attribute
  in any static page.
