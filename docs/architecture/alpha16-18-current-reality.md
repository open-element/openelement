# Alpha16–18 current reality and contradictions

Date: 2026-11-03. Baseline: `4f1f2001b24909086f7e7efe9e5016d48d615c91`.
Status: **READ-ONLY AUDIT**. Evidence is cited by path and line. Deeper
narrative is in [the architecture audit](./alpha16-18-architecture-audit.md);
the target is [the canonical architecture](./compiler-native-architecture.md).

**2026-11-08 addendum.** The first-party Lit renderer retirement that this
2026-11-03 audit records as initiated with its window still OPEN — the Router
matrix's "Lit renderer" row, contradiction row C-09, boundary question 14 and
the retirement-order table's Lit row — was executed zero-compat by the ADR-0152
2026-11-08 owner ruling, merged as PR #1719 `ec09d444e`. The `./lit` and
`./lit-ssr` subpaths, their entry modules and the renderer branch are removed,
and `renderer: 'lit'` fails with an explicit migration error. The audit body
stays as the 2026-11-03 snapshot.

Classification vocabulary: **IMPLEMENTED**, **PARTIALLY IMPLEMENTED**,
**PLANNED**, **PROPOSED**, **DEPRECATED**, **RETIRED**,
**NEEDS INVESTIGATION**.

## A. Current reality matrix

### Compiler

| Capability | Status | Evidence | What the evidence does not prove |
| --- | --- | --- | --- |
| TSX parse → semantic analysis → lowering → Part Program | IMPLEMENTED | `semantic-core/compile.ts:109-186` | nothing about full TSX |
| Restricted-JSX grammar (single root, no fragments, no spread, limited conditions/lists) | IMPLEMENTED | `compile.ts:141-152`, `lower-program.ts:450-465,529-536,818-820` | that the limits are permanent |
| Part Program v2 emission (`__partProgram` JSON) | IMPLEMENTED | `emit-module.ts:295,354-356,528` | that it is the target execution form |
| Generated module + Source Map v3 | IMPLEMENTED | `emit-module.ts:124-535`, `source-map.ts` | generated DOM codegen |
| Diagnostics (`OEC####`, source-located) | IMPLEMENTED | `compiler-diagnostics.ts`; 25 OEC9007/OEC9013 references across semantic-core | a code registry (codes are literals at throw sites) |
| Server function components (string composition) | IMPLEMENTED (bounded) | `server-component.ts:1-33,442`; `element/src/server.ts:108-197` | async (explicitly rejected, `server-component.ts:174-175`), client instances |
| Function component authoring for the browser | NOT IMPLEMENTED | same evidence; no runtime JSX value | — |
| Generated client mount/claim/update/dispose | PLANNED | ADR-0174 records it as accepted direction, implementation NOT RUN (`ADR-0174:9-13`) | — |
| Semantic IR distinct from wire format | APPROVED TARGET (not implemented) | canonical architecture §4.1 | any separation exists today |

### Element runtime

| Capability | Status | Evidence |
| --- | --- | --- |
| Class component lifecycle + kernel connect (claim vs fresh) | IMPLEMENTED | `open-element-implementation.ts:20-36,327-361` |
| Program normalization per class | IMPLEMENTED | `compiled/runtime-program.ts` |
| Fresh DOM walker + fixed Part executors | IMPLEMENTED | `runtime/fresh-dom.ts:40-70`, `runtime/parts.ts` |
| When / Each blocks, keyed entries, `byKey` | IMPLEMENTED | `runtime/blocks.ts:119-152,246,303,356,599` |
| Live item for keyed reuse (`itemBox`) | IMPLEMENTED | `runtime/blocks.ts:175-190,204-224` |
| Claim/hydration with bounded recovery | IMPLEMENTED | `runtime/hydrate.ts:76-93,226-248,867` |
| Ownership / cleanup (`LifetimeScope`) | IMPLEMENTED | `compiled/lifetime-scope.ts:4-109` |
| Signals integration | IMPLEMENTED | `@preact/signals-core` (`packages/element/package.json:52`) |
| Tree-shaking installation seams (blocks/hydrate) | IMPLEMENTED | `runtime/blocks-install.ts:1-40`, `runtime/hydrate-seam.ts:1-70` |
| Runtime JSX value representation | NOT IMPLEMENTED | `jsx-runtime.ts:20-42,44-53` (throws; uninhabited type) |
| Hostless component instances | NOT IMPLEMENTED | no such primitive in the tree |
| Runtime generic interpreter removal | NOT STARTED | current walkers are the shipping path |

### Protocol / metadata

| Capability | Status | Evidence |
| --- | --- | --- |
| Part Program v2 types + validator | IMPLEMENTED | `protocol/part-program.ts:22-47,90-101`, `validatePartProgram` |
| Generated module ABI version | IMPLEMENTED (v2) | `part-program.ts:37` |
| Metadata vs execution separation | NEEDS INVESTIGATION | §4.1: `__partProgram` serves four roles |
| Public export of protocol | IMPLEMENTED | `protocol/package.json:29`, `protocol/src/index.ts:13` |

### Router / full stack

| Capability | Status | Evidence |
| --- | --- | --- |
| Framework Mode, loaders/actions/forms, SSR/SSG | IMPLEMENTED | `packages/router/src/vite/internal/...`; fixtures |
| Native renderer integration | IMPLEMENTED | renderer selection + `renderer-runtime.ts:167-175` |
| Lit renderer | IMPLEMENTED (retiring, separate track) | `router/src/lit.ts:63-83`, `router/package.json:35-56` |
| Compiled-class detection for routing | IMPLEMENTED | `router/src/authoring.ts:441-445` — a **runtime property-presence** check (`component.__partProgram !== undefined`) plus a prototype-descriptor arm; not a source scan |
| Blocks detection by source text | IMPLEMENTED, and lexical | `ssg/island-blocks-scan.ts:117-120` — `source.includes('__partProgram')` plus a `"blocks": [{` shape test on the emitted JSON |
| CSS-edge recovery from emitted artifacts | IMPLEMENTED, and lexical | `compiler/src/internal/compiler/compiled-artifact-style-requests.ts:42,122,143,196` — marker prefilter, then parses the emitted module to recover `__partProgram`, style requests and scope facts |
| Stream route validation | IMPLEMENTED | `server-runtime/route-dispatch.ts:47-83` reads `default.__partProgram` for `tag`/`version` against the stream manifest |
| Stream identity check | IMPLEMENTED | `server-runtime/stream-runtime.ts:516-525` (tag + version) |
| Generated module shape typing | IMPLEMENTED | `server-runtime/types.ts:46` (`__partProgram?: { version; tag }`) |
| Compiled page tag resolution | IMPLEMENTED | `server-runtime/renderer-runtime.ts:167-175` |

Correction to an earlier draft of this document: it claimed **two Router
consumers scan `__partProgram` as a source string**. That was wrong. There are
exactly **two lexical/source-text consumers in the whole tree**, and only one of
them is in Router:

| Lexical consumer | Location | Why it scans text |
| --- | --- | --- |
| SSG blocks detection | `router/src/vite/internal/ssg/island-blocks-scan.ts:117-120` | packed installs ship already-compiled modules whose blocks cannot be re-derived from authoring grammar |
| Compiler CSS/style-edge recovery | `compiler/src/internal/compiler/compiled-artifact-style-requests.ts:42,122-143` | re-derives style requests from an emitted module before the runtime reads it |

Both are consequently **release blockers for any change to the emitted field
shape**, and both must migrate in the same change as the ABI that replaces it.

### Delivery

| Capability | Status | Evidence |
| --- | --- | --- |
| Packed consumers, exact-SHA evidence, release gates | IMPLEMENTED | `tools/release/`, root `gate:*` scripts |
| Browser matrix (3 engines) | IMPLEMENTED (release train) | `packages/element#browser:gate:full`, router browser tests |
| Budgets | IMPLEMENTED | `tools/release/css-cost-report.ts` and release fixtures (exact owners to re-read before changing any threshold) |

## B. Contradiction matrix

Only genuine conflicts are listed. Scope differences and historical statements
are noted as such rather than "fixed".

| ID | Document / code | Current statement | Conflict | Evidence | Resolution |
| --- | --- | --- | --- | --- | --- |
| C-01 | ADR-0173 §`Connection and identity` | "The initial fragment contract is single insertion, not arbitrary cloning or transfer between roots" | Owner now requires repeated consumption to create independent instances (TSX-09/10) | ADR-0173 line 28; owner direction 2026-11-03 | **Resolved** by the 2026-11-03 amendment in ADR-0173; historical text preserved |
| C-02 | ADR-0174 | "Generate browser mount, claim, update and dispose code" accepted | Repository still emits `__partProgram` JSON and interprets it | `emit-module.ts:295`; `fresh-dom.ts:40-70` | Scope difference: accepted direction vs unimplemented. Both docs already say NOT RUN; the canonical doc states it explicitly |
| C-03 | Product model | Was: "A standard Custom Element is the durable component boundary" | Target: CE is one boundary among several; internal composition is hostless | now reads "standard Custom Elements remain the native export, independent-control and island activation boundary" (`docs/architecture/product-model.md:10`) | **Resolved** by the 2026-11-03 wording; no further action |
| C-04 | ADR-0143 | Exclusive CE/class author model, single supported authoring path | Function components become the primary authoring path | ADR-0143:8-13; ADR-0173 amendment | Already amended by ADR-0173/0174; no new action |
| C-05 | Architecture docs (`compiler-and-element-runtime.md`) | "one mandatory compiler … lowers supported TSX into a Part Program" | Target adds generated code alongside the program | `compiler-and-element-runtime.md:1-6` | Scope: current description stays true until codegen lands; add a target pointer rather than rewriting |
| C-06 | jsx-runtime header | "Compiled output never calls these factories" | Will remain true for the target too, but the header implies JSX values cannot exist | `jsx-runtime.ts:1-17` | Not a conflict; the model note explains the new value representation is separate from these factories |
| C-07 | Alpha16-18 blog (www) | Presents `component(...)` as planned API | No implementation; candidates may change | `www/content/blog/2026-10-31-alpha16-18-a-clearer-direction.zh.md:33-47` | Already disclaimed in the article; no change needed |
| C-08 | ADR-0174 release gate vs plan A16-5 | Plan allowed shipping both execution paths when the old executor could not be retired | Direct conflict with the ADR-0174 requirement that the old generic executor be unreachable before Alpha16 release | ADR-0174:57-59; plan §A16-5 and §7 | **Resolved** by the owner-approved Alpha16a/Alpha16b split (D-O1): gate kept intact for Alpha16b; 16a is internal only. See ADR-0174 amendment 2026-11-03 |
| C-09 | Architecture docs | Lit is one of two first-class renderer modes | Retirement initiated | ADR-0152:107-115 + 2026-11-03 amendment | Already superseded by amendment; window OPEN |
| C-10 | `product-model.md` | "two public core products" | Target keeps two products; nothing conflicts | — | No conflict (recorded to prevent re-litigating) |

## C. Boundary answers

1. **Is Part Program compile-time IR, browser execution protocol, or both?**
   Both today: compile-time structural representation *and* the browser
   execution protocol (emitted as `__partProgram`, interpreted by the walkers).
2. **Which portions remain compile-time only?**
   None are isolated today; the same JSON serves both. Separating them is a
   approved migration (canonical §4.1), not implemented.
3. **Which consumers need it for SSR?**
   `element/src/public-runtime.ts:725-790` (title/root kind/parts/metadata) and
   the server serializer entry (`compiled/server/index.ts:674-681`).
4. **Which consumers need it for Router?**
   Routing detection by presence of `__partProgram`
   (`router/src/authoring.ts:442`), tag resolution
   (`server-runtime/renderer-runtime.ts:167-175`), blocks detection by source
   text (`ssg/island-blocks-scan.ts:117`), stream identity
   (`server-runtime/stream-runtime.ts:523-525`), island/SSG admission.
5. **Which consumers need only metadata?**
   `public-runtime.ts:222` (tag), `:378` (`metadata.properties`), `:419`
   (registration), and the stream manifest's tag/version checks.
6. **Can class and function components share one generated backend?**
   Yes in principle: both lower to the same semantic model and would emit the
   same generated shape; the class frontend is a migration input that retires in
   Alpha16b, not a parallel adapter design. Not proven — no function backend
   exists.
7. **What must the minimal runtime contain?**
   Signals, `LifetimeScope`, narrow effects for dynamic dependencies, DOM/range
   helpers, event installation, security sinks, and platform interop. Each needs
   an owner, test and retirement condition (canonical P4).
8. **Which responsibilities remain dynamically coordinated?**
   Signal subscription and invalidation, keyed reconciliation decisions that
   depend on runtime keys, claim/mismatch recovery, scheduling, streaming
   cancellation, and third-party CE callbacks.
9. **What is the claim contract?**
   Attach generated execution to server-produced DOM preserving identity, text
   and attributes, input/focus/selection, DSD, cleanup ownership, and bounded
   recovery on mismatch (`runtime/hydrate.ts:76-93,226-248`).
10. **What is the ownership contract?**
    Parent/child `LifetimeScope`, owner cleanups LIFO (children visited in
    insertion order), per-scope error isolation,
    idempotent dispose, range cleanups, disposal ≠ DOM detachment
    (`lifetime-scope.ts:83-109`).
11. **Which EachBlock / Item Box concepts can be reused?**
    `EachEntry { key, scope, nodes, item, itemBox }`, `byKey`, and the
    dispatch-time `itemBox` read (`blocks.ts:119-152,204-224`). Reuse the
    *concept*; the implementation must be re-qualified, not assumed.
12. **Which installation seams are obsolete versus still consumed?**
    `blocks-install.ts` and `hydrate-seam.ts` are consumed by public entries for
    tree-shaking (`blocks-install.ts:1-40`, `hydrate-seam.ts:1-70`). They are
    **not obsolete**; the hydrate seam changes only if claim becomes generated,
    and only with measurement.
13. **What does the approved Alpha16 gate require about the old executor?**
    ADR-0174 requires graph evidence that it is unreachable before Alpha16
    release, plus coverage and qualification (`ADR-0174:57-59`). The gate is
    **decided, not open**: the owner approved the Alpha16a/Alpha16b split on
    2026-11-03 (D-O1). Alpha16a is internal with no release; **Alpha16b is the
    only release route** and must satisfy the gate. If the evidence cannot be
    produced, no Alpha16 release is cut.
14. **Which Lit retirement requirements are independent?**
    All of them: last supported version, breaking release, compatibility window,
    security owner, migration docs, export/dependency removal, Native parity,
    rollback. They do not gate Alpha16.

## C-bis. `__partProgram` production consumer map

Repository-wide search (`__partProgram`, `PartProgramV2`, `PartProgram`,
`PART_PROGRAM_VERSION`, `COMPILED_MODULE_ABI_VERSION`, `normalizePartProgram`,
`createFreshDom`, `hydrateExistingDom`, `addRangeCleanup`, `dispose(true)`)
separated production consumers from tests and docs. Production consumers:

| Consumer | Actual file / function | Current role | Layer | Target role | Migration stage | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Element facade | `open-element-implementation.ts:72-79,327-361` | fails closed when the compiled program is missing; drives connect | browser runtime | keep (metadata + program until generated mount lands) | 16a | `failMissingProgram`, `kernel.connect()` |
| Compiled statics contract | `internal/compiled/facade-host.ts:6,28` | declares/consumes `__partProgram`, `__compiledProperties`, handler table | browser runtime | keep statics; shrink program use | 16b | type `__partProgram?: PartProgram` |
| Program normalization | `internal/compiled/runtime-program.ts` | validates + normalizes the program once per connect | browser runtime | shrink to metadata once the walker retires | 16b | module header |
| Public runtime / SSR | `public-runtime.ts:222,378,419,520-540,725-790` | tag, `metadata.properties`, registration, stream shell digest, HTML serialization | server + browser | request-time path runs the generated server entrypoint over a server-private structure; it reads no Semantic IR | staged | `renderToStringAtDepth`, `createStreamShellExecutor` |
| Server entry | `element/src/server.ts` | compiled property metadata + root kind | server | keep | — | server rendering path |
| Server serializer module | `internal/compiled/server/index.ts:674-681` | serialization entry | server | keep | — | entry |
| Router page classification | `router/src/authoring.ts:441-445` | **runtime property presence** + prototype arm | build/browser | Router-plugin build-time classification fact, **not an ABI field** | 16b | function body |
| Router page tag | `server-runtime/renderer-runtime.ts:167-175` | resolves compiled page tag | server | keep tag metadata | 16b | comment + access |
| Router stream validation | `server-runtime/route-dispatch.ts:47-83` | tag/version vs stream manifest | server | keep; ABI-aware | 16b | `readPartProgram` |
| Router stream identity | `server-runtime/stream-runtime.ts:516-525` | tag + version mismatch rejection | server | keep | 16b | guard |
| Router types | `server-runtime/types.ts:46` | generated module shape | build | keep; extend for ABI | 16b | interface field |
| SSG blocks detection | `ssg/island-blocks-scan.ts:117-120` | **lexical** scan + blocks shape | build | replace with emitted metadata flag | 16b | `compiledArtifactMightUseBlocks` |
| Compiler CSS recovery | `compiler/.../compiled-artifact-style-requests.ts:42,122-196` | **lexical** prefilter, then parse emitted module for style/scope facts | build | replace with emitted ABI metadata | 16b | `COMPILED_ARTIFACT_MARKER`, `PART_PROGRAM_BINDING` |
| Program kernel types | `internal/compiled/runtime/program-kernel.ts:13,38,44` | type-level slices of `PartProgramV2` for parts/branches | browser runtime | type-only; follows the ABI | 16b | type imports |
| Hydration seam types | `runtime/hydrate-seam.ts:22,35` | type signature of the installed claim executor | browser runtime | keep until claim is generated | 16b | type import |
| Revive | `runtime/revive.ts:254,284` | range cleanups for revived blocks (reconnect path) | browser runtime | keep; depends on non-detach semantics | 16b | `addRangeCleanup` |
| SSG source records | `protocol/src/ssg.ts:10,24-25` | type-only projection of `sourceMap.records` | build/server | keep (metadata) | staged | type import |
| Rendered-component type | `element/src/public-runtime.ts` compiled-constructor types | program shape for serializer entry | server | keep | staged | type |
| Protocol schema | `protocol/src/part-program.ts` | schema, validator, versions | shared | keep transitional | staged | `PART_PROGRAM_VERSION`, `COMPILED_MODULE_ABI_VERSION` |
| Public protocol export | `protocol/src/index.ts:13`, `protocol/package.json:29` | public subpath | distribution | retires with the protocol (approved P-2/P-4); new ABI subpath in Alpha17 | 16b | export map + release note |

Test/fixture consumers (not production, listed separately): generated fixtures
under `packages/element/__wtr__/generated/*`, element/router suites asserting
program shape, packed-consumer harnesses, and `tests/fixtures/**`.

What this map establishes:

- Exactly **two** consumers read the emitted field as text, and they are in two
  different packages.
- `authoring.ts` is a runtime property check and must not be described as lexical;
  its target channel is build-time page classification, not an ABI field.
- **SUPERSEDED HISTORY (D-O2):** the earlier reading said browser-executor
  retirement is **not** Part Program deletion and that server serialization,
  streaming and build-time consumers keep reading program data after the walker
  retires. The approved fourth pass retires Part Program v2, the validator,
  `PART_PROGRAM_VERSION` and `__partProgram` from the target production contract in
  Alpha16b; the server keeps a **server-private structure**, which is not the old
  program data. The release gate and the retirement policy remain two obligations.

## D. Alpha15 asset preservation audit

| Asset | Class | Why | Evidence |
| --- | --- | --- | --- |
| Signals (`@preact/signals-core` + internal contract) | Preserve | proven reactive base; no source evidence of a fundamental limit | `packages/element/package.json:52` |
| `LifetimeScope` | Preserve | already the ownership primitive the target needs | `lifetime-scope.ts:4-109` |
| EachBlock + `byKey` + `itemBox` | Reuse (concept) | keyed identity and live-value semantics exist | `blocks.ts:119-152,204-224` |
| Fixed Part executors | Refactor → replace after qualification | correct behaviour, wrong structure for P2 | `runtime/parts.ts` |
| Fresh DOM walker | Replace after qualification | generic structural execution | `runtime/fresh-dom.ts:40-70` |
| Claim/hydration executor | Refactor, then generated where feasible | must keep fidelity and bounded recovery | `runtime/hydrate.ts:867` |
| Installation seams | Preserve until measured | consumed for tree-shaking | `blocks-install.ts:1-40` |
| SSR serializer + DSD | Preserve | HTML-first promise | `public-runtime.ts:725-790` |
| Security sink screening | Preserve | single source of truth for URLs/attrs | `protocol/src/forbidden-sinks.ts` |
| Diagnostics + source maps | Preserve and extend | every new grammar needs codes and locations | `compiler-diagnostics.ts`, `source-map.ts` |
| Part Program + validator | CURRENT FACT: transitional; APPROVED TARGET: retire in Alpha16b | emitted artifact shared by runtime, SSR, Router and build consumers today; the server-private replacement is not the old schema | §C-bis; roadmap |
| Class/decorator authoring | CURRENT FACT: shipping; APPROVED TARGET: retire in Alpha16b after class→function migration, with no adapter | one authoring model; generated CE boundary for native exports | ADR-0173 fourth-pass amendment; roadmap |
| Router Framework Mode | Preserve | application layer is not rewritten | `packages/router/src/vite/...` |
| Lit renderer | Retire after separate qualification | owner decision, window OPEN | ADR-0152 amendment |
| Third-party WC interop | Preserve | native boundary | `entry-descriptor.ts` admission paths |
| Packed consumers + release gates | Preserve | evidence discipline | `tools/release/` |
| Behavioral tests | Preserve and migrate | regression base for every slice | element/router suites |

## E. Owner decisions (approved 2026-11-03)

These are **APPROVED**. Do not re-ask.

### D-O1 — APPROVED: Alpha16a / Alpha16b split (Option C)

- **Alpha16a** is an internal compiler-native foundation milestone: new
  execution model, new generated path introduced, existing generic executor
  retained for un-migrated capabilities, leaf and stateful foundations proven,
  applicable G1/G2 evidence. No public version, tag, publication, Starter
  promise or release claim follows from it.
- **Alpha16b** is the formal Alpha16 release qualification: all required browser
  capabilities migrated, generated mount/update/claim/disposal, class-authoring
  migration and API retirement (no adapter), Router integration, packed-consumer
  and browser/server qualification, and graph evidence that the old generic
  browser executor is unreachable from every applicable production browser entry
  graph.
- **The ADR-0174 hard gate remains intact.** A formal Alpha16 release with the
  old generic browser executor still reachable does not qualify. Alpha16a does
  not amend or bypass it.
- The gate targets the old generic **browser execution path**, not deletion of
  every Part Program artifact or every server-side consumer.

If Alpha16a succeeds and Alpha16b does not: the work stays internal; no Alpha16
release is cut; the remaining migration is re-planned with the failing
capability named. Shipping both paths as a release is not an option.

### D-O2 — PARTIALLY SUPERSEDED (2026-11-03, fourth pass)

The staging discipline (define layers first, per-consumer migration, no premature
ABI freeze) remains in force. Its KEEP conclusion is **superseded**: the serialized
protocol, `__partProgram`, the old validator and the old version are approved for
retirement. The new ABI is designed in M01 and constrained by packed-consumer
evidence — it is not frozen here.

Define the layer boundary first (semantic IR · Part Program v2 · emitted
`__partProgram` · generated-module ABI · HTML/claim/stream wire · metadata), then
migrate consumers on evidence. Do not delete or rename `__partProgram`, do not
freeze a new ABI, and keep server serialization, streaming, routing, CSS recovery
and identity checks working until each consumer's own migration condition is met.

### D-O3 — SUPERSEDED (2026-11-03, fourth pass)

The 2026-11-03 D-O3 decision (long-lived Class API adapter) is **superseded** by
the approved fourth-pass package: the Class/Decorator authoring API is retired and
no compatibility adapter is built. The old record remains above as history.

*(Historical text of the superseded record, retained verbatim above.)* Class and
function authoring were to share one semantic model and one generated backend,
with the adapter treated as compatibility infrastructure. That decision no longer
governs: the fourth-pass package **retires the Class authoring API and builds no
adapter**, and `OpenElement` is no longer an author-facing base class.

## F. Remaining OPEN engineering details

Not owner decisions — implementation details that need evidence, each with the
test that will settle it:

| # | OPEN item | Decided by |
| --- | --- | --- |
| O-1 | Props tracking granularity (instance version vs per-property) | cost measurement on the stateful list + TSX-28 evaluation counts |
| O-2 | Exact evaluation-count contract for inline expressions with multiple reads | TSX-28 |
| O-3 | Claim marker protocol for ordered repeated insertion | TSX-30 across SSR→claim |
| O-4 | Whether an ownership token/ancestry query is needed for projection validation | TSX-26 cross-owner rejection |
| O-5 | Intrinsic-subtree template cloning as an optimisation | byte measurement, not design preference |
| O-6 | Cross-module recipe distribution (deferred to Alpha17) | TSX-21 packed-consumer matrix |
| O-7 | Context representation and reactivity | TSX-13 |
| O-8 | `onConnect` / `onDispose` final names and signatures | Alpha17 G3 author evidence |
| O-9 | HMR state preservation | TSX-22 |
| O-10 | Iterable admission beyond arrays | TSX-16 |
