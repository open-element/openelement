# Compiler IR and ABI boundary (M01)

Date: 2026-11-03. Milestone: **Alpha16a M01**. Status: **DESIGN — not implemented.**
Base: `11b58f13e73bc7ae539e5de554646b0fc1e4a0a4`.
Revision 2026-11-05: §15 item 7 now records the owner's per-read props decision;
TSX-28 verifies and records the counts/cost. This is a documentation sync, not
implementation evidence.

Approved direction this document must serve (2026-11-03, P-1…P-5): function-first
Full TSX; compiler-owned semantic model; independent server/client backends; no
generic browser interpreter; retire the Class authoring API; retire Part Program v2
as a serialized browser protocol; remove `__partProgram` from the target module
contract; retire the old validator and version; **no** authoring compatibility
adapter.

Binding constraint on this document: it designs a **boundary**, not a frozen ABI.
Two members are deliberately left unfrozen — the concrete ABI field set and the
exact IR node shapes — because packed-consumer evidence must constrain them.

## 1. Executive decision

1. **One semantic model, two backends.** The compiler owns an internal Semantic IR
   that is never shipped and never interpreted. The server backend renders HTML/DSD
   from it; the client backend generates mount/update/claim/dispose from it.
2. **No shared executable artifact.** There is no serialized structure that both
   backends execute. Server-private and client-private structures are allowed; a
   common serialized runtime protocol is not.
3. **A narrow generated-module ABI replaces `__partProgram`.** The ABI carries
   facts and entrypoints with named consumers, not a structural program.
4. **Build metadata is a separate channel** from the runtime ABI, and either may be
   omitted when a build-time tool can derive the fact itself.
5. **The wire carries serialized output, markers, permitted seed, resources and
   build identity** — never a component execution program.
6. **Runtime shrinks to primitives**: signals, ownership, DOM/range helpers, event
   installation, security sinks, claim recovery, platform interop.

## 2. Current implementation reality (evidence)

What exists today, so the design is not confused with it:

| Fact | Evidence |
| --- | --- |
| The compiler's only frontend is class-shaped (`@element`, `render()`) | `semantic-core/analyze-module.ts:844` (`analyzeCompiledModule`), `compile.ts:134-152` |
| The compiler emits `__partProgram` JSON + metadata + handler forwarding | `semantic-core/emit-module.ts:295,354-356,528` |
| The compiler has **no standalone IR type**; the program tree *is* its output shape | `protocol/part-program.ts:22-47`, `emit-program.ts` |
| The browser interprets that program with fixed executors | `runtime/fresh-dom.ts:40-70`, `runtime/parts.ts`, `runtime/blocks.ts` |
| Claim walks existing DOM with bounded recovery | `runtime/hydrate.ts:76-93,226-248,867` |
| Ownership is `LifetimeScope` | `compiled/lifetime-scope.ts:4-109` |
| No runtime JSX value exists | `jsx-runtime.ts:20-53` |
| Server function components are string composition, sync only | `server-component.ts:1-33,135,173-175` |

Consequence: today's "IR" and today's "wire" are the same object. M01's whole job is
to make that false.

## 3. Target architecture

```text
Full TSX
   │
   ▼
Compiler frontend            (function components; class frontend retires in Alpha16b)
   │
   ▼
Semantic IR                  (compiler-owned; never shipped; not a protocol)
   │
   ├──────────────► Server backend ──► HTML / DSD / seed / stream metadata
   │
   └──────────────► Client backend ──► generated mount / update / claim / dispose
                                              │
                                              ▼
                                     Minimal runtime helpers
                                              │
                                              ▼
                                       Native web platform
```

Layer prohibitions:

| Layer | Must not do |
| --- | --- |
| Semantic IR | be shipped as a browser program; be a public API; be a second TypeScript AST |
| Server backend | execute client-generated code; require symmetry with the client |
| Client backend | interpret a generic program; walk a VNode tree; require the server's structure |
| ABI | carry structure; become a universal descriptor |
| Build metadata | enter the browser runtime ABI |
| Wire | carry an executable component program |

## 4. Semantic IR

The IR is the compiler's private contract. Its job is to make the *semantic*
decisions that both backends consume.

Minimum semantic units:

| Unit | Carries | Why it must exist |
| --- | --- | --- |
| `Component` | identity, props form, children form, private state, lifecycle hooks | component semantics are compile-time known |
| `Element` | tag, static attrs, dynamic bindings | every backend needs the DOM shape |
| `Text` | static text or expression | smallest dynamic unit |
| `Binding` | target kind (text/attr/prop/event/ref/class/style), expression ref, source span | replaces Part typing without shipping it |
| `Condition` | test expression, consequent trees | structural region |
| `List` | items expression, key expression, item template | keyed identity |
| `Fragment` / multi-root | ordered children | hostless output |
| `Insertion` | a JSX value used in value position (recipe) | reusable insertion semantics |
| `Expression` | authored expression + free variables + tracking hints | one place owns reactivity shape |
| `Resource` | subscription/effect/cleanup acquisition site | ownership accounting |

Deliberately **not** in the IR: DOM nodes, serialized opcodes, runtime type tags,
slot numbering for a generic executor, or a public node-kind vocabulary.

Invariants:

1. IR nodes are created only by the compiler; nothing at runtime constructs them.
2. Expressions are opaque closures-with-metadata, not re-parsed AST at runtime.
3. Every IR node carries a source span; diagnostics and Source Map v3 derive from
   it (preserving the Alpha15 baseline).
4. Reactivity is represented as *where reads happen*, not as precomputed
   dependencies only; dynamic reads stay dynamic.
5. Ownership is represented as a tree of resource owners parallel to the output
   tree, so the client can emit `LifetimeScope` calls and the server can scope
   requests.
6. JSX values are represented as insertion recipes (§11 Example 4), not as values
   the runtime can inspect.

Open: whether the IR is a plain object graph, a typed node union, or lowered
directly to backend-specific trees. This is an implementation choice for M02,
not a contract.

## 5. Server backend (two distinct things, not one)

A previous draft used "server backend" for both of the following. They are
different and must not be conflated:

### 5.1 Compiler-time server backend

A **code generator**. It runs inside the compiler (build time), consumes the
Semantic IR, and emits the server rendering code for a component. It is the
server-side counterpart of the client codegen, not a runtime.

It may emit a **server-private generated structure** — closures, template
strings, a render plan — as long as that structure is:

- produced by the compiler, not by serializing the IR;
- consumed only by the server runtime;
- never shipped to the browser;
- never interpreted by a generic engine.

**A server-private structure is not "the IR serialized for the server."** The IR
does not cross a process boundary in any form. If the server needs a persisted
intermediate, it is a separate server-owned artifact with its own version, not
the compiler's IR.

### 5.2 Request-time generated server execution

The emitted server entrypoint runs per request:

1. the router resolves the route and loads the module;
2. the generated server entrypoint is called with request-scoped inputs
   (resolved data, params, request-scoped context);
3. it renders HTML — and DSD where the component's root mode requires it — by
   invoking the generated render functions;
4. it emits permitted seed data (serializable only) and stream metadata/build
   identity when the route streams.

Request scope rules:

- no module-level mutable state on the render path; per-request objects only;
- full-await in **Alpha16b (M14)**: data is awaited before output; no out-of-order
  fragment streaming (bounded defer is Alpha18);
- server-only modules never enter client graphs (existing guard, #1618);
- streaming keeps admission, backpressure, cancellation and identity checks.

### 5.3 Shared rules for both

The server never executes client-generated code, and the client never executes
server-generated code. Sharing is at the semantic level (one IR, one meaning),
not at the artifact level.

## 6. Client backend

Generates, per component:

- mount: create the region, install static DOM, attach bindings;
- update: per-binding update functions, not a tree walk;
- claim: adopt server-produced DOM, install bindings, recover within bounds;
- dispose: teardown through owners.

Allowed runtime helpers (each with an owner and a retirement condition; see §10):
signal creation/tracking, `LifetimeScope`, DOM/range operations, event installation,
security sinks, claim mismatch recovery, keyed region coordination.

Forbidden: a Part opcode loop, a VNode tree interpreter, a generic DOM walker, a
runtime type-dispatch table for components.

## 7. Generated module ABI

Two candidate designs were evaluated.

**Option 1 — named exports + a small metadata record (recommended).**
Each generated module exports concrete entrypoints (`mount`, `update`, `claim`,
`dispose`, plus a server render entry) and a `componentMeta` record holding only
facts with named consumers. Version and build identity are separate constants.

**Option 2 — single descriptor object.** One object holds entries, metadata and
version. Rejected as the default: it recreates the "one big object the runtime
reads" pattern that made `__partProgram` hard to retire, and it invites structural
fields back in.

Recommended field candidates, each justified by a consumer in
[the migration matrix](./m01-consumer-migration-matrix.md):

| Field | Producer | Consumer | Purpose | Layer | Stage |
| --- | --- | --- | --- | --- | --- |
| tag | compiler | registration (`customElements.define`) | **component identity metadata** | ABI | Alpha16b |
| properties/attributes metadata | compiler | facade, SSR seeding, forms | prop ↔ attribute conversion | ABI | Alpha16b |
| root mode | compiler | SSR/DSD, claim | light vs shadow-open/closed | ABI | Alpha16b |
| style/scope facts | compiler | CSS delivery, SSG CSS recovery | style assets | ABI (or build metadata) | Alpha16b |
| static features (blocks, islands, handlers) | compiler | SSG blocks detection, island admission | build decisions | Build metadata | Alpha16b |
| client entrypoints | compiler | bundler, runtime | mount/update/claim/dispose | ABI | Alpha16b |
| server entrypoint | compiler | SSR | render to HTML | ABI | Alpha16b |
| ABI version | compiler | runtime, Router, stream | compatibility | ABI | Alpha16b |
| build identity | bundler | stream, deployment | skew rejection | Wire/metadata | Alpha16b |

Rules: no field without a named consumer; no structural program; no runtime
dispatch table; metadata and entrypoints may be separate exports. The exact set is
**not frozen** here.

**Component identity metadata vs build-time route classification.** These are
different facts with different consumers and must not share one field:

| Fact | Consumer | Channel |
| --- | --- | --- |
| Component tag / identity | runtime registration, SSR seed, claim identity | **ABI** (runtime) |
| "This module is a page element class, not a function page" | Router route scanning at build time | **build-time classification**, derived by the plugin |
| "This package component needs blocks/browser code" | SSG/SSG-package admission at build time | **build metadata** (emitted flag or graph fact) |

The earlier C07 row (Router reading `__partProgram` presence) is a *runtime
property check used as a build-time discriminator*. In the target it becomes a
build-time classification fact, not an ABI field.

### 7.1 Versioning: three separate checks

| Check | Owner | When | Meaning |
| --- | --- | --- | --- |
| `PART_PROGRAM_VERSION` | current schema | today | retires with the schema (approved P-4) |
| `COMPILED_MODULE_ABI_VERSION` (v2) | current generated-module ABI | today | **retires**; superseded by the new ABI's own version (approved P-3/P-4) |
| **New ABI version** | new generated-module contract | from Alpha16b | Alpha16b performs **compatibility checking only**: generated module ↔ runtime helpers ↔ server/client build identity |
| **Cross-module ABI freeze** | Alpha17 | Alpha17 | the stable published contract between a precompiled library and a consumer |

Alpha16b checking ABI compatibility is **not** an ABI freeze. The freeze — the
guarantee that a library compiled against ABI N works in a consumer on ABI N — is
an Alpha17 deliverable constrained by packed-consumer evidence.

## 8. Build metadata

Questions to answer per fact before emitting anything:

1. Does it need to leave build time at all?
2. Can the Vite plugin compute it directly?
3. Can the module graph answer it?
4. Does it belong in a separate manifest rather than the module?

Working split: SSG blocks detection, island admission, CSS asset requests, Router
classification and build identity are **build-time decisions**. Where they must be
persisted, they belong in the existing build manifest, not in the browser runtime
ABI. No second metadata registry.

## 9. Wire: HTML / DSD / Claim / Stream

Carries: HTML, DSD template output, claim markers, component/region identity,
permitted seed data, stream manifest, resource references, deployment build
identity.

Must not carry: a component execution program, closures, DOM nodes, complete signal
graphs.

Independent identities stay independent: **ABI version ≠ component identity ≠
build identity ≠ stream identity.**

Preserved guarantees: input/focus/selection fidelity, pre-activation events,
bounded mismatch recovery, request isolation, security sinks, cancellation.

## 10. Runtime boundary

| Capability | Keep | Reason | Retirement condition |
| --- | --- | --- | --- |
| Signals | yes | reactive base | none foreseen |
| `LifetimeScope` | yes | ownership/cleanup | none foreseen; API shape open |
| narrow effects | yes | dynamic dependencies | only if generated code removes the need |
| DOM/range helpers | yes | platform ops | none |
| event installation | yes | platform ops | none |
| security sinks | yes | one source of truth | never (safety) |
| claim recovery | yes | bounded mismatch | only if generated claim subsumes it |
| keyed coordination | yes | dynamic keys | only with generated equivalent |
| generic DOM walker | **retire** | old interpreter | M10 browser proof |
| program normalization | **retire** | only the walker needs it | M10 |

Test: every retained helper must be callable from generated code and must not be
able to run a component on its own.

## 11. Five worked examples

### 11.1 Static hostless component

```tsx
const Page = () => <><Header /><Main /><Footer /></>;
```

- Semantic facts: three component insertions, ordered, no host element.
- IR: `Component` (Page) → `Fragment[Component(Header), Component(Main), Component(Footer)]`.
- Server: renders three HTML ranges in order.
- Client: generates three mount calls; no `customElements.define`.
- ABI need: none beyond entrypoints.
- Wire need: ordering only.
- Open: how the claim marker identifies three sibling ranges (`Region` identity).

### 11.2 Signals-driven component

```tsx
const Counter = () => {
  const n = signal(0);
  const d = computed(() => n.value * 2);
  return <button onClick={() => n.value++}>{n.value}:{d.value}</button>;
};
```

- IR: component with two derived resources; two `Text` bindings reading
  `n.value`/`d.value`; one event `Binding`.
- Server: initial text only; event handler not installed.
- Client: generated `mount` creates signals, attaches text bindings and listener.
- Runtime helpers: signal, effect/tracking, event install, owner.
- ABI: none. Wire: none.

### 11.3 Stateful keyed list

`items.map(item => <Row key={item.id} item={item} />)` with private draft state.

- IR: `List { items, key, template }`, template `Component(Row, props=item)`.
- Server: ordered HTML with per-row keys.
- Client: generated keyed algorithm — key→instance map, move/insert/delete,
  props replacement without re-setup, disposal via owner in detach mode.
- Runtime: keyed coordination + owner + range ops.
- ABI: none. Wire: keys/order for claim alignment.
- Open: claim marker encoding for ordered keys.

### 11.4 Reusable JSX value and repeated Children projection

```tsx
const c = <Counter />;
return <>{c}{c}</>;
```

Per the approved model (`jsx-value-and-children-model.md`), a value-position JSX
expression lowers to a **compiler-emitted insertion recipe**: an opaque closure
bound to a statically known mount function. Each insertion creates a fresh owner,
instance, DOM range and cleanups.

Why this is not a VDOM:

- the callee is fixed at compile time (no runtime resolution from a value);
- there is no tree to diff and no traversal entry point;
- the recipe cannot be inspected or serialized, so no generic walker can consume it;
- repeated consumption is defined as repeated *creation*, not as cloning a region.

Not allowed: sharing a mounted region, moving one instance to two positions,
`cloneNode` of mounted DOM, publishing a VNode type.

Open: the ownership-lineage mechanism that proves a projection stays inside the
defining owner's subtree (model note §4.1c).

### 11.5 SSR → DSD → Claim

Same stateful list.

- Server backend renders HTML/DSD, seeds permitted data, stamps build identity.
- Client backend generates `claim`, which adopts nodes, binds without duplicate
  subscriptions, preserves input/focus/selection, and recovers within a bounded
  owner on mismatch.
- Runtime: claim recovery + owner + signals.
- ABI: client entrypoints only. Wire: markers, seed, build identity.
- Open: marker protocol for repeated insertion ordering.

## 12. Consumer migration matrix

See [m01-consumer-migration-matrix.md](./m01-consumer-migration-matrix.md) — 23
consumers, each with file, symbol, access type, target layer, replacement, stage,
test and retirement condition.

The matrix is the single source of these counts; this document does not keep a
second tally. What it establishes structurally:

- every production consumer has a named target layer;
- exactly **two** consumers read the emitted module as source text, in two
  different packages;
- every proposed ABI field lists a named consumer (the matrix is the authority);
- fixtures, harnesses and release tooling are classified as supporting evidence,
  not as protocol consumers.

## 13. Infrastructure reuse

Verified against manifests and source, not assumption.

| Tech | Actual state | Policy |
| --- | --- | --- |
| Vite | workspace-wide, `peer` in compiler, dependency in router | ADOPT |
| Rolldown | used through Vite's build; no direct dependency | ADOPT (via Vite) |
| Oxc (`oxlint`/`oxfmt`) | root devDependencies | ADOPT (lint/format only) |
| Oxc parser | **not** the compiler parser; no evidence of use | DEFER (post-Alpha18 evaluation) |
| TypeScript compiler API | direct dependency of compiler and router (`typescript@6.0.3`) | ADOPT now; `ParserPort` is TypeScript-bound by design |
| `@preact/signals-core` | devDependency in `packages/element/package.json:56`, **materialised into runtime dependencies by the packed manifest** (`tools/release/npm-manifest.ts:493-501`); product source never imports it directly (enforced by `check-signal-protocol-boundary.ts`) | ADOPT |
| PostCSS + `postcss-value-parser` | direct router dependencies, used for CSS AST | ADOPT |
| Web Streams, Fetch/Request/Response | platform | ADOPT |
| Source Map **generation** | hand-written VLQ in `semantic-core/source-map.ts:47,103-117` | KEEP baseline; reuse evaluation deferred |
| `@jridgewell/trace-mapping` | devDependency (element, router) | ADOPT for **consumption**, not generation |
| parse5 | not a dependency | DO NOT INTRODUCE |
| Lightning CSS | not a dependency | DO NOT INTRODUCE |

Corrections to older assumptions: PostCSS is genuinely used (any older text saying
otherwise is stale); Oxc tooling ≠ Oxc parser; `@preact/signals-core` is not a
source dependency but is a published runtime dependency; the source-map *generator*
is in-repo even though a source-map *consumer* library is vendored.

## 14. M01 acceptance criteria

M01's own gates are named **M01-A1…M01-A6** to avoid colliding with the Alpha16
qualification gates **G1** (real generated execution) and **G2** (identity /
ownership), which keep their approved names and are earned in M05–M06.

| M01 gate | Criterion | Status |
| --- | --- | --- |
| **M01-A1** layer separation | six layers defined; no universal descriptor | met by this document |
| **M01-A2** consumer completeness | every production consumer mapped; every proposed ABI field has a consumer | met by the matrix |
| **M01-A3** compiler feasibility | IR expresses the five examples; not TS AST; not a re-implemented JS AST | met by design; to be proven in M02 |
| **M01-A4** runtime feasibility | no generic interpreter target; JSX values do not become VNode | met by design |
| **M01-A5** compatibility/safety | SSR/DSD/claim fidelity, security, isolation, cancellation accounted | specified; to be proven in M06–M08 |
| **M01-A6** scope control | docs only; no source/export/dependency/version change | met |

**Completion statement.** M01 is complete when A1–A6 hold for this contract. That
is **not** G1 or G2, and **not** Alpha16a: G1/G2 are earned by the generated
execution and identity slices in M05–M06, and **Alpha16a exits at M08 with G1/G2
recorded**.

## 15. Open engineering questions and settled semantics

1. IR representation form (object graph vs typed union vs direct lowering).
2. Claim marker protocol for ordered repeated insertion.
3. Ownership lineage mechanism for cross-owner projection rejection.
4. Key encoding in the wire for keyed claim alignment.
5. Where style/scope facts live: ABI or build metadata.
6. Whether the server backend generates render functions directly or emits a
   separate **server-private render plan** — that plan must not be a serialized
   copy of the Semantic IR (§5.1), and it carries its own lifecycle and version.
7. Props getter evaluation is **DECIDED (owner ruling): every read evaluates**.
   What remains OPEN is the measured count/cost evidence (TSX-28), not the
   semantics. A per-update-tick cache that changes evaluation count, returned
   value or side-effect order is a different contract, not an optimization.
8. Exact boundary between generated update code and retained helpers.

Claim marker/order, key alignment, permitted seed state and bounded recovery are
acceptance obligations of **M07** (leaf claim) and **M08** (stateful SSR→claim);
they are not M01 design deliverables. The marker protocol may be designed in M07,
but it may not be deferred to Alpha17 with a callback or API name.

## 16. Deferred decisions

- Final ABI field set — blocked on packed-consumer evidence (Alpha17 freeze).
- Cross-module recipe distribution — Alpha17.
- Bounded defer wire changes — Alpha18.
- Rust/Oxc compiler frontend — post-Alpha18 evaluation.

## 17. Risks

| Risk | Trigger | Mitigation |
| --- | --- | --- |
| IR grows into a de-facto protocol | someone serializes it for convenience | hard rule: IR never crosses a process boundary |
| ABI re-becomes `__partProgram` | adding structural fields "just for now" | field requires a named consumer; review gate |
| Two backends drift semantically | server and client implemented independently | shared IR + one semantic test matrix |
| Lexical consumers left behind | field shape changes without migrating scans | matrix rows named as blockers |
| Runtime helpers expand into a framework | convenience helpers accumulate | each helper needs owner + retirement condition |

## 18. References

- [Canonical architecture](./compiler-native-architecture.md)
- [Fourth-pass reassessment (approved)](./alpha16-18-fourth-pass-reassessment.md)
- [JSX value / Children model](./jsx-value-and-children-model.md)
- [TSX author contract](./tsx-author-candidate-contract.md)
- [Consumer migration matrix](./m01-consumer-migration-matrix.md)
- [Execution plan](./alpha16-18-execution-plan.md)
- ADR-0173, ADR-0174

## Amendment (2026-11-09): Alpha16a additive candidate codes and the M14 seam

Owner decision 2026-11-09 (compatibility note only; no ABI freeze, no release
claim):

- `RuntimeErrorCode.LEAF_CLAIM_UNAVAILABLE` (PR #1745, squash `0a97602c4`) and
  `RuntimeErrorCode.STATIC_RANGE_MISMATCH` (PR #1747, squash `0df1621a5`) are
  additive members of the existing exported const. Both are recorded in
  `docs/release/public-interface-snapshot.json` per ADR-0137.
- Published `renderFunctionPageAwaited` (PR #1748) is recorded by the ADR-0169
  amendment (2026-11-09); `renderFunctionPage` keeps its synchronous string
  contract.
- These are candidate API for the internal Alpha16a chain. The cross-module ABI
  freeze stays Alpha17 and still requires packed-consumer evidence; no version,
  tag or publication is implied.
