# ADR-0181: Generated-element server rendering, instance retention and style declarations

- Status: ACCEPTED
- Date: 2026-11-15
- Owner ruling: 2026-11-15 — land the generated Native Custom Element path on the
  server (compiler-owned host producer + atomic single-owner registration +
  nested renderer), the private retained-instance ledger with root and depth-1
  retention, and the `defineIslandConfig({ styles })` declaration channel wired
  into the **existing** router style plan.
- Related: ADR-0173, ADR-0174, ADR-0177, ADR-0163, ADR-0180

## Context

Alpha16b needs the generated (function-component) island path to render on the
server, not only on the client. Before this slice the pipeline stopped at a
compiler-emitted host producer with **no consumer**: the entry did not import it,
the registration guard had no pairing, and the serializer's nested callback
refused any component without `__partProgram`. Three smaller gaps sat behind it:
no retained instance scope across reconnect, no author style channel for
generated islands, and no way to carry a compiler fact to request-time rendering
without runtime module-shape inference (the pattern C07 rejects).

The slice also touched the tracked interface baseline
(`public-interface-snapshot.json`) without an authorizing record. Under
`design-principles.md` P2 ("runtime surface needs an ADR") and P7, that made the
surface an unnamed deviation. This record authorizes it and enumerates exactly
what changed, so a reviewer can diff the decision against the snapshot.

## Decision

### A. Server rendering of generated hosts

1. **The compiler owns the export identity.** The emitter returns
   `ssrHostExport` from the **same** `hostWrapper` decision that appends the
   wrapper, and the leaf reports the root instance factory from the same
   emission point. Callers never re-derive a name, never scan a namespace
   suffix, and never read a class static.
2. **Build-only carriers.** The island scan records a five-state
   `GeneratedElementHostIdentity` (`producer`, `missing-producer`,
   `light-no-producer`, `lane-declined`, `lane-refused`) on the existing scan
   result; `buildEntryDescriptor` re-attaches the fact (delivery aliases
   included). The public `IslandDecl` / `EntryDescriptor` protocol shapes are
   unchanged.
3. **Static named import, one pairing call.** For an SSR-admitted producer
   island the generated entry emits exactly one static named import of the
   compiler-owned export plus one `__registerSsrIsland(tag, ctor, host)` call. A
   missing producer or a non-identifier name fails the build closed with the
   existing `OE_DESCRIPTOR_MODULE_IMPORT`. `ssr:false`, light-root, declined and
   refused islands keep their previous bytes.
4. **Atomic single-owner registration.** `SsrRegistryGuard.registerIsland`
   shares the guard's existing ownership decision, validates both halves before
   any mutation, pairs a renderer only when this call owns the class
   registration, and clears a stale pair on class-only re-registration and on a
   lost ownership conflict.
5. **One value algebra.** Host attributes reach the producer through the
   serializer's existing canonical normalization; a generated element's declared
   primitive attributes seed content props through the shell's existing
   `convertFromAttribute` plus declared defaults, with lazy supplied values (the
   M09 getter contract). Non-primitive / `attribute:false` seed parity is **not**
   claimed.
6. **Boundaries.** Streamed/deferred execution structurally refuses the nested
   seam, so a generated host inside a streamed region renders as a plain tag with
   no DSD. That is characterized and OWED, not supported. A malformed or
   non-function pair fails closed with the existing `OE_PROGRAM_MISSING`.

### B. Retained instance ledger

A private ledger (`instance-ledger.ts`) keyed by the owning `LifetimeScope`
provides retain/release/pass-bracket primitives with explicit, mode-independent
release: eviction is decided by the emitted act, never inferred from a disposal
mode. The generated root retains its own setup record across reconnect (setup
count stays 1) and every retained hostless child retains its own, at any depth.

> **Superseded in part (2026-11-21, depth ≥ 2 delivered).** The paragraph above
> originally stopped at depth 1 and called depth ≥ 2 OWED "behind a cross-ledger
> transaction protocol". That protocol is now implemented and wired, so the
> depth-1 ceiling is history:
>
> - the ROOT retaining body opens the attempt and keeps its
>   `InstanceTransaction` token; a retained body that retains its own children
>   calls `joinInstancePass(ownScope, token)` and NEVER commits or aborts;
> - the root's `endInstancePass` commits the root pass first (its sweep may evict
>   a removed child, recursively releasing that child's ledger) and then every
>   surviving member, skipping members whose ledger was released or whose pass
>   number no longer matches; `abortInstancePass` aborts members deepest-first;
> - evicting ANY entry first releases that scope's OWN ledger, so grandchild
>   bookkeeping can never outlive its owner and an explicit owner teardown closes
>   a live transaction's member passes before dropping the ledger;
> - the compiler's eligibility fixpoint gained one more owner class (a retained
>   body that itself retains children), so depth-1 modules keep their exact
>   pre-change bytes: no token capture, no join, no `txn` host field.
>
> Evidence at `6fc34e713` (LOCAL, clean tree): compiler 1421 tests (102 files), element 1063 (136 files), the
> Chromium depth ≥ 2 rows R8/R10/R11 (retained grandchild across reconnect; an
> aborted attempt that commits no child pass and converges; owner teardown
> releasing the whole subtree once) and the ledger's five transaction rows. The
> `p1-applicability`/milestone records are unaffected: this is a capability
> delivery, not an exit claim.

### C. Author style declaration for generated islands

`defineIslandConfig({ styles })` is validated once (relative `.css`, bounded,
duplicate-free) and admitted **only** on a light-root generated island, where it
registers into the **existing** style-edge registry the class lane feeds, emits
one content-addressed `@scope`d asset and records it in the client asset
manifest. A shadow-root declaration fails the build closed with
`OE_ISLAND_STYLE_SHADOW_UNWIRED` naming the missing DSD style-link carrier
(M09-2e) and GH #1800; a class-lane or unadmitted declaration fails with
`OE_ISLAND_STYLE_LANE_UNSUPPORTED`. A declared sheet is never silently dropped.
Application of the emitted stylesheet (document link / shadow adoption) is
carried by GH #1800.

> **Superseded in part (2026-11-20, alpha16 retirement closeout).** Three facts in
> the paragraph above are now **history**, and a reader must not take them as
> current:
>
> 1. **A shadow-root declaration no longer fails closed.** The DSD style-link
>    carrier exists: the compiler emits the typed `styleLinks` channel on the host
>    producer and `serializeGeneratedElementHtml` writes the canonical marked
>    `<link>` prefix INSIDE the template. The build scan admits a `producer`
>    identity with root `shadow`; the authoring face (`defineIslandConfig`), which
>    had kept refusing the same combination as "not wired yet", was corrected to
>    agree. Only `missing-producer` still fails closed, which is the honest case
>    (no template to declare the sheet in).
> 2. **Light-root APPLICATION is delivered.** #1800's document-level application
>    landed: a light-root render reports the island's declared sheets to the
>    render's document sink (the same rule the class lane's light root already
>    followed), and "declared but carrier unavailable" stays a loud failure rather
>    than an unstyled render.
> 3. **What is still OWED is narrower than the paragraph implies**: the
>    client-side SHADOW adoption slice (`ssr: false` islands, whose root the shell
>    creates client-side and which adopt no stylesheet), and the generated lane's
>    hoisting of a nested light root's sheet into an enclosing shadow template —
>    the latter measured this session by porting `site-light-probe` and reverting
>    it.
>
> Evidence for each is in `alpha16-class-migration-matrix.md` and the capability
> inventory; this note exists so the ADR does not contradict them.

## Enumerated interface deltas (diff this against the snapshot)

| Package | Delta | Kind |
| --- | --- | --- |
| `@openelement/protocol` | `SSR_REGISTRY_GENERATED_HOSTS` (root and `./registry-markers`) | additive constant |
| `@openelement/element` `./internal/compiled/generated-element/shell` | `createInstance?` on the descriptor; `instance?` on `GeneratedElementHost`; `seedGeneratedElementHostProperties` | additive optional / additive helper on an internal subpath named by ADR-0177 |
| `@openelement/element` `./internal/compiled/runtime` | seven ledger functions re-exported for emitted code | additive, internal subpath |
| `@openelement/element` (root subpaths) | `onConnect`, `onDispose` | additive, authorized by ADR-0180 |
| `@openelement/compiler` (`compileGeneratedElementIfAdmitted`) | return object gains `ssrHostExport` | additive field on an existing shape |
| `@openelement/router` `./server-runtime` | `SsrRegistryGuard.registerIsland`, `GeneratedApp.registerSsrIsland` | additive methods |
| `@openelement/router` (root) | `IslandConfig.styles?` | additive optional field |

No symbol is removed or renamed; `createRecipe` (required), `props` and
`propsChanged` are retained. The emitted shadow host producer gains a third
parameter (`props`, `lightChildren`, `attributes`): an **emitted-artifact ABI**
change, not a public import change. Mixed-artifact compatibility is a versioned
concern for the next release line; a compatibility check is owed in the release
lane (ADR-0174 mixed-artifact), and until it exists the two arities must not be
mixed in one build.

## The four questions (P7)

1. **Platform first (P1).** The design uses the platform's own Custom Element
   lifecycle, shadow root and DSD. No new runtime phase, no second renderer, no
   browser-side executor: the server path *removes* an executor dependency
   rather than adding one.
2. **Compile-time cost (P2).** The host producer, the root instance factory and
   the retention plan are all emitted code; the runtime additions are a private
   ledger module and two small shell hooks, not a framework runtime. Modules that
   need none of it stay byte-identical (pinned by test).
3. **Runtime reads as platform code (P3).** The request-time seam reads a
   protocol marker table written by the registration guard; it performs no
   module-shape inference and no `__partProgram` read for generated hosts. The
   server runtime gains no Node dialect (all new `node:*` usage is build-time or
   CLI).
4. **Prior art (P7.4).** The registration-pair pattern follows the existing
   `ENTRY_REGISTRATION_OWNERS` side table (single owner, dev-re-evaluation
   replacement); DSD host serialization follows the class lane's own serializer;
   the style path reuses the class lane's style plan rather than adopting a
   second mechanism (`adoptedStyleSheets` adoption stays in GH #1800). The
   deliberate difference from the class lane is that a function module cannot
   read a class static, so the identity is a compiler return value.

## Consequences and limits

- Not claimed: M09 exit, M11 completion (M11-2 request-time generated **page**
  rendering and M11-3 client entry cutover remain open), P1–P5 proofs, M12/M13
  qualification, packed-consumer evidence, non-primitive seed parity, streaming
  DSD for generated hosts, depth ≥ 2 retention, shadow-root style adoption.
- The browser entry still loads the generic executor, so **P1 stays NOT MET**;
  the evidence tool records that truthfully rather than passing.
- `apps/saas` remains outside CI coverage (pre-existing); its `appShell → layout`
  migration is a consumer fix, not new runtime surface.

## Retirement conditions (P5)

```
RETIRE the generated-host registration pair WHEN P1 reports MET on the tracked
  browser-entry graph artifact for every applicable production app at one clean SHA ;
  VERIFY gate:source AND gate:packed GREEN AT THAT SHA ;
  RECORD 16b-MN + browser-entry-graph evidence ; OWNER single owner
RETIRE the private instance ledger WHEN the emitted retention plan is replaced by the
  Alpha17 precompiled distribution AND no emitted module imports the ledger ;
  VERIFY gate:source GREEN AT one SHA ; RECORD 16b-MN row ; OWNER single owner
RETIRE OE_ISLAND_STYLE_SHADOW_UNWIRED WHEN GH #1800 lands a shadow style-link carrier AND
  a shadow-root generated island with styles builds and renders on three engines ;
  VERIFY gate:release GREEN AT one SHA ; RECORD 16b-MN row ; OWNER single owner
```

Each condition is an event on a standard artifact, never a date or a review
cadence.

## Alternatives rejected

- **Runtime module-shape inference for the host name** (class static, namespace
  suffix scan): the exact pattern C07's corrected row forbids for build facts,
  and it creates a second naming authority.
- **Router-only top-level dispatch**: insufficient — generated islands nest
  inside class pages, so the nested seam is the real consumer.
- **A second style pipeline** (adoptedStyleSheets inside Alpha16): deferred to
  GH #1800 with an explicit fail-closed refusal instead of a silent drop.
- **Inferring "retain vs release" from a disposal mode**: refuted by review —
  the same mode is used for both logical kills and rollbacks, so eviction is
  driven by explicit emitted release sites and pass epochs.

## Amendment (2026-11-16): minimal DSD stylesheet-link carrier (M09-2e / #1803)

This is a later reading in the amend-never-rewrite form; it rewrites no
decision above and creates no milestone evidence.

- A shadow-root generated host now delivers its declared `styles` sheets as the
  canonical marked `<link>` nodes INSIDE the DSD template. The compiler reads
  the `styles` presence from the SAME authored sidecar metadata it already reads
  for root/focus/props, so a scan-time and a transform-time compile of one
  module cannot disagree. The client build joins every admitted shadow
  declaration to its emitted asset (a declared sheet with no asset fails the
  build closed), the emitted `<Name>__ssrHost` carries the typed styleLinks
  channel only for that styled site, and the generated claim skips exactly that
  marked prefix (an unmarked node is never swallowed).
- A shadow-root style edge ships the authored bytes verbatim (no `@scope`); the
  registry already had that edge shape for class shadow roots, so no second
  style pipeline, hash or registry is introduced.
- `OE_ISLAND_STYLE_SHADOW_UNWIRED` now covers only a shadow island with no
  compiled host producer (no template to declare the link in).

### Enumerated interface deltas (diff this against the snapshot)

Two additive signature/shape changes, with no symbol added or removed: these
are observable interface changes, not a claim of an unchanged API. Both are necessary
because a shadow root's sheets must be declared inside its DSD template, and
the existing delivery seams have no per-island half; a second setter or a
second registry would be a second mechanism for one fact.

| Package / entry | Delta | Necessity and compatibility |
| --- | --- | --- |
| `@openelement/element` `.`, `./base`, `./client-only`, `./no-blocks` | `__setRequestTimeStyleSheetUrls(urls, islandEntries?)` gains one optional parameter (`islandEntries` = per-tag URL lists; `null` = declared but carrier unavailable). | Reuses the existing internal-by-convention setter seam and the one generated-entry import; a one-argument call remains valid and behaves exactly as before, so no old caller or byte path changes. A second setter would have expanded the public surface with a duplicate mechanism. |
| `@openelement/element` `./internal/compiled/generated-element/shell` (ADR-0177 internal subpath) | `GeneratedElementSsrInput` gains optional `styleLinks?: readonly string[]`; `serializeGeneratedElementHtml` reflects it. | The emitted host producer needs the typed channel to place the canonical marked links inside the template. This is emitted-artifact ABI on an internal subpath, not author API; omitted keeps the pre-slice shape and bytes. |

The source interface snapshot records these implemented shapes after code
review; updating it is not release approval or a public API freeze. Owner
release sign-off and mixed-artifact qualification remain separate obligations.
This amendment records no owner sign-off, milestone exit or release claim.

- Still open and not claimed: light-root document application and client/shadow
  adoption (GH #1800); the dev server has no emitted-asset carrier, records the
  explicit unavailable state and fails closed; no M09/M11 status, P5 evidence,
  version, tag or publication is created.

## Later reading (2026-11-20)

P1–P5/M10/M11 status follows the 2026-11-20 re-record in the head
[progress ledger](../architecture/alpha16-18-progress.md) and the
[P1 applicability record](../architecture/p1-applicability-record.md); the
`P1 stays NOT MET` sentence under "Consequences and limits" above is the state
as recorded at the time of writing. This later reading is append-only: it
rewrites no decision above, creates no milestone evidence, P5 evidence or
release claim, and adds no owner sign-off.

## Later reading (2026-11-20): the last style adoption slice landed

Append-only; this rewrites no decision above and creates no milestone, P5 or
release claim.

The 2026-11-16 amendment's "still open" list named client/shadow style adoption.
It is now delivered, with one environmental limit unchanged:

- An `ssr: false` (or `hydrate: 'only'`) island's declared `styles` are delivered
  by the compiler emitting real `.css` module-graph imports and the
  generated-element shell adopting the resulting sheet objects through the class
  lane's SAME `CompiledStyleScope` into the root it created. Section C's
  "application is carried by GH #1800" is therefore closed for adoption.
- Section C's "admitted only on a light-root generated island" remains the rule
  only for the SERVER-rendered shape's producer requirement: a shadow-root
  declaration is admitted when the island is client-only (the browser creates the
  root) or when the leaf emitted the compiled DSD host producer (the marked
  `<link>` carrier). `OE_ISLAND_STYLE_SHADOW_UNWIRED` now refuses exactly the
  server-rendered, producer-less case.
- The failure closure §C promised is implemented at BOTH ends: the compiler
  refuses a client-only declaration that reaches it without a static specifier
  (`OEIR_GENERATED_ELEMENT_CLIENT_STYLES_UNWIRED`), and the shell refuses a
  non-sheet descriptor value with a coded build-phase error rather than adopting
  it.
- The dev-server no-emitted-asset limitation and the nested-light-root hoisting
  boundary are unchanged: the latter stays a written rule, not a capability.

### Enumerated interface deltas (2026-11-20 client style adoption)

One additive shape change, recorded by the `interface:snapshot` write; no symbol
is added or removed.

| Package / entry | Delta | Necessity and compatibility |
| --- | --- | --- |
| `@openelement/element` `./internal/compiled/generated-element/shell` (ADR-0177 internal subpath) | `GeneratedElementDescriptor` gains optional `styles?: readonly StyleSheetLike[]`. | This is the emitted-artifact ABI through which a client-only island's declared sheets reach the shell that adopts them. Omitted keeps every pre-slice descriptor byte-shape and behavior; the compiler emits it only for an `ssr: false` / `hydrate: 'only'` island with declared styles. It is not author API (the subpath carries no stability promise) and adds no public package export. |

The snapshot also updates the four signature strings that embed the descriptor
type (`createGeneratedElementClass`, `defineGeneratedElement`,
`resolveGeneratedElementProps` and the descriptor's own symbol). No
`RenderToStringOptions` change is involved; `onNestedFailure` remains this line's
one public addition.

### Enumerated interface deltas (2026-11-21 depth >= 2 transaction)

One additive symbol on the same internal subpaths, recorded by the
`interface:snapshot` write.

| Package / entry | Delta | Necessity and compatibility |
| --- | --- | --- |
| `@openelement/element` `./internal/compiled/runtime` and `./internal/compiled/leaf-runtime` | new export `joinInstancePass(owner, transaction)`; `beginInstancePass(owner)` now RETURNS its `InstanceTransaction` (a call whose result is ignored is unchanged, so the depth-1 emitted text keeps working byte-for-byte). | The emitted child body is the caller: it must join the root attempt's transaction instead of committing its own child pass. Emitted-artifact ABI on ADR-0177's internal subpaths — no stability promise, no public export, and a module with no retained child keeps exactly its previous bytes and graph. |

### Written rule (2026-11-20): a light root must not be nested inside a shadow template

This is a RULE, not a capability. No code was built for it, and the generated
lane will not hoist a nested light-root sheet into an enclosing shadow template.

- **Rule.** A light-root component must not be rendered inside another
  component's shadow template. Use a `<slot>` (slotted content stays in the light
  DOM and is styled by the document) or make the child a shadow root.
- **Why it is a rule and not a gap.** Document stylesheets never cross a shadow
  boundary. A light root's CSS is a document resource (`@scope`d document sheet /
  the render's document sink); when the element is placed in a shadow tree, the
  document cannot reach it. Hoisting the child's link into the parent's DSD
  template — what the class lane did — is a workaround for a composition that the
  platform itself does not support; it is not a contract, and the generated lane
  does not reproduce it.
- **Evidence.** `tests/fixtures/site-light-probe`'s generated port was built and
  run; it measured the missing delivery and was reverted (the class version's e2e
  is green, 25/25). The handoff's §6 measurement records **0** product-code
  instances of the nesting across `www/app`, `apps/saas/app`, `packages/ui/src`
  and `packages/create/templates`; this rule section cites that measurement
  rather than re-running it.
- **Fixture consequence.** `site-light-probe`'s e2e row is to be rewritten to
  assert the RULE (the composition is authored as `<slot>` or a shadow child),
  and only then can that fixture migrate. That rewrite belongs to the lane
  deletion's change set, not to a capability slice.
