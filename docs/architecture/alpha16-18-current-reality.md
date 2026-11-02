# Alpha16–18 current reality and contradictions

Date: 2026-11-03. Baseline: `4f1f2001b24909086f7e7efe9e5016d48d615c91`.
Status: **READ-ONLY AUDIT**. Evidence is cited by path and line. Deeper
narrative is in [the architecture audit](./alpha16-18-architecture-audit.md);
the target is [the canonical architecture](./compiler-native-architecture.md).

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
| Semantic IR distinct from wire format | PROPOSED | canonical architecture §4.1 | any separation exists today |

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
| Compiled-class detection for routing | IMPLEMENTED, and lexical | `router/src/authoring.ts:432-442` (presence of `__partProgram`) |
| Blocks detection by source text | IMPLEMENTED, and lexical | `ssg/island-blocks-scan.ts:105-117` (`source.includes('__partProgram')`) |
| Stream build-identity check | IMPLEMENTED | `server-runtime/stream-runtime.ts:516-525` (tag + version) |

The two "lexical" rows are the strongest argument against removing
`__partProgram` casually: two consumers match it as a *string in source*, not
through a type or symbol.

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
| C-08 | Taskbook gate G1 | Alpha16 release requires graph evidence that the old executor is unreachable | No mechanism in place to produce that evidence, and old path is the only path today | ADR-0174:57-59 | **Owner decision required** (see §D-O1); do not weaken silently |
| C-09 | Architecture docs | Lit is one of two first-class renderer modes | Retirement initiated | ADR-0152:107-115 + 2026-11-03 amendment | Already superseded by amendment; window OPEN |
| C-10 | `product-model.md` | "two public core products" | Target keeps two products; nothing conflicts | — | No conflict (recorded to prevent re-litigating) |

## C. Boundary answers

1. **Is Part Program compile-time IR, browser execution protocol, or both?**
   Both today: compile-time structural representation *and* the browser
   execution protocol (emitted as `__partProgram`, interpreted by the walkers).
2. **Which portions remain compile-time only?**
   None are isolated today; the same JSON serves both. Separating them is a
   PROPOSED migration (canonical §4.1).
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
   same generated shape; class keeps a frontend adapter. Not proven — no
   function backend exists.
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
    Parent/child `LifetimeScope`, LIFO cleanup, per-scope error isolation,
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
    release, plus coverage and qualification (`ADR-0174:57-59`). Whether that
    remains feasible in one release is an **open owner decision** (D-O1).
14. **Which Lit retirement requirements are independent?**
    All of them: last supported version, breaking release, compatibility window,
    security owner, migration docs, export/dependency removal, Native parity,
    rollback. They do not gate Alpha16.

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
| Part Program + validator | Preserve as transitional; split roles | four roles, two lexical consumers | §C1, §C4 |
| Class/decorator authoring | Refactor to compatibility adapter | one backend rule (P5) | ADR-0173 amendment |
| Router Framework Mode | Preserve | application layer is not rewritten | `packages/router/src/vite/...` |
| Lit renderer | Retire after separate qualification | owner decision, window OPEN | ADR-0152 amendment |
| Third-party WC interop | Preserve | native boundary | `entry-descriptor.ts` admission paths |
| Packed consumers + release gates | Preserve | evidence discipline | `tools/release/` |
| Behavioral tests | Preserve and migrate | regression base for every slice | element/router suites |

## E. Open owner decisions

**D-O1 — Alpha16 gate feasibility.** ADR-0174 requires graph evidence that the
old executor is unreachable before Alpha16 release. Producing that evidence in
one release requires the generated backend to cover everything the walker does
(including claim, blocks, styles, streaming). Options: (a) keep the gate and
accept that Alpha16 slips; (b) amend the gate to "old executor unreachable for
the new model's path, remaining consumers listed with owners" — weaker, must be
explicit; (c) split Alpha16 into 16a (new model alongside) and 16b (retirement).
Recommendation: (c), because it preserves the gate's intent without pretending
coverage exists.

**D-O2 — metadata/execution split timing.** Splitting `__partProgram` into
execution data and metadata touches Router's lexical detection. Decide whether
the split happens in Alpha16 or after the generated backend is proven.

**D-O3 — class API direction.** Keep as a long-lived adapter or schedule a
deprecation? P5 forbids a parallel renderer but not a long-lived adapter.
