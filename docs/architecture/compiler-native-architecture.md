# Compiler-native architecture (canonical)

Date: 2026-11-03. Status: **ACCEPTED IN DIRECTION, INCLUDING THE FOURTH-PASS
DECISION PACKAGE (P-1…P-5) APPROVED 2026-11-03**: the Class authoring API and the
serialized Part Program protocol are retired as the target, `__partProgram` leaves
the generated-module contract, and the old validator/version retire with the
schema ([reassessment](./alpha16-18-fourth-pass-reassessment.md)). Approval is
policy-level: nothing is deleted and no ABI is frozen by this document.
Baseline: `4f1f2001b24909086f7e7efe9e5016d48d615c91`.

This is the single canonical statement of the Alpha16–18 target architecture.
Other documents link here instead of restating it:

- decisions and their amendments live in [the ADR index](../adr/README.md)
  (ADR-0152, ADR-0173, ADR-0174 and their amendments);
- the JSX value / Children execution model is
  [its own note](./jsx-value-and-children-model.md);
- the author contract is [the TSX contract](./tsx-author-candidate-contract.md);
- current state and evidence are [the audit](./alpha16-18-architecture-audit.md)
  and [the current-reality matrix](./alpha16-18-current-reality.md);
- execution and acceptance are [the plan](./alpha16-18-execution-plan.md) and
  [the test matrix](./alpha16-18-semantic-test-matrix.md).

## 1. Destination

> A Compiler-native, Signals-driven, HTML-first full-stack Web framework, where
> the compiler owns UI semantics and generates specialized server and client
> execution code, while a minimal runtime supplies only the reactive, lifecycle,
> dynamic-coordination and platform primitives that cannot be generated.

**Compile the UI. Don't interpret it.**

Nothing here is implemented. Alpha15 still executes a generic Part Program in
the browser; that remains the shipped behaviour until a qualified replacement
exists.

## 2. Principles P1–P5

### P1 — Compile-time ownership

The compiler owns component and expression recognition, lexical-scope analysis,
component identity and composition semantics, props/children semantics, reactive
dependency locations, structural DOM decisions, security validation, and the
choice of execution path where it is statically knowable. A decision that can be
made at compile time must not be deferred to runtime.

### P2 — No generic browser interpreter

The final browser execution path must not require interpreting a generic Part
Program or a VDOM. This prohibits a generic structural walker, a tag/type
dispatch table, and a generic reconciliation entry point.

It does **not** prohibit shared helpers for URL screening, attribute coercion,
event installation, range operations, ownership, scheduling, or other proven
primitives. "No interpreter" is not "no runtime".

### P3 — Signals-driven updates

Signals hold values, track subscriptions and notify computations. Generated code
performs the precise update. A signal change must not re-execute a component
body; it updates the bindings that depend on it. Dynamic dependencies may need
narrowly scoped runtime tracking — bounded tracking is the requirement, not
universal static discovery.

### P4 — Minimal runtime

Runtime keeps only what cannot reasonably be eliminated or generated: signals,
narrow effects where dynamic tracking is required, ownership and cleanup, DOM
range helpers, scheduling, and platform interop. Every retained runtime
responsibility needs an owner, a scope, a behaviour test and a retirement
condition.

### P5 — One client execution backend, one independent server rendering backend

Function authoring is the **only** long-term frontend; the class frontend retires
in Alpha16b (approved P-1) and **no compatibility adapter is built** (approved
P-5).

There is **one client execution backend** for the component model: one semantic
model, one ownership/identity model, one signals engine, one generated execution
shape, one ABI. There is **one independent server rendering backend** producing
HTML/DSD from the same semantic model.

The two backends share **semantic ownership, not a common execution protocol**:
no shared serialized program, no shared interpreter, and no requirement that the
server executes client-generated code (or the reverse).

A second client execution backend — a second renderer, or a legacy path kept
alive for compatibility — is prohibited permanently.

## 3. Responsibility split

| Layer | Owns | Must not own |
| --- | --- | --- |
| Compiler frontend | parse, semantic analysis, diagnostics, source maps | runtime state, DOM |
| Compiler backends | server lowering/codegen, client codegen, ABI emission, static optimization | interpreting its own output in the browser |
| Generated client code | mount, claim, update, event install, keyed ranges, disposal | generic structural dispatch |
| Runtime | signals, ownership/cleanup, narrow effects, DOM/range/security helpers, platform interop | component semantics, structural interpretation |
| Server | SSR/DSD serialization, request lifecycle, streaming bounds | client structural decisions |
| Router | routes, loaders/actions/forms, navigation, renderer integration | component execution semantics |

## 4. Canonical boundaries

### 4.1 Five separate layers (do not conflate them)

An earlier revision of this document said "`__partProgram` has four roles" and
described the Part Program as the compiler's structural representation. That
conflated a **compiler output** with the **compiler's internal representation**.
They are different artefacts and are corrected here.

| Layer | What it is | Where it lives today | Transitional? |
| --- | --- | --- | --- |
| **A. Compiler Semantic IR** | internal representation used for analysis, lowering, optimisation and code generation | implicit in `semantic-core` (no standalone IR type today) | No — it is the compiler's own contract |
| **B. Part Program v2** | serializable structural artifact produced by the current compiler | `packages/protocol/src/part-program.ts` (schema + validator + version) | **RETIRE (approved)** as a browser protocol; the server may keep a private structure |
| **C. `__partProgram`** | the **emitted static field** on a generated module that carries artifact B | produced by `emit-module.ts`; consumed by Element/SSR/Router | **REMOVE (approved)** from the target contract; replaced by a narrow ABI |
| **D. Generated module ABI** | contract between generated modules and runtime helpers/facades | `COMPILED_MODULE_ABI_VERSION`, statics shape | Not frozen; needs its own versioning |
| **E. HTML / Claim / Stream wire** | serialized HTML, markers, permitted seed data, resources, build identity | SSR serializer, stream manifest, claim markers | Preserved; may evolve with migration |

Binding consequences:

- The new compiler must not be architecturally constrained by artifact B. Its
  internal IR is not automatically a public protocol, and a compile-time IR may
  survive after the browser stops interpreting structure.
- **CURRENT FACT:** the Part Program, its validator and the emitted field are the
  shipping execution contract; nothing may be deleted before its consumers are
  migrated.
- **APPROVED TARGET (2026-11-03):** the serialized program is retired as a
  browser protocol, `validatePartProgram`/`PART_PROGRAM_VERSION` retire with the
  schema, and the module carries a narrow generated ABI instead. The ABI's actual
  structure is **not** frozen here: M01 designs it and packed-consumer evidence
  constrains it. Until each consumer migrates, the transitional rules above
  govern in practice.
- Do not remove metadata merely because the browser stops interpreting
  structure: tag, version and properties are consumed by Router, SSR and stream
  identity checks.
- Do not remove server serialization or stream data because browser codegen
  replaces the generic walker. **`program.parts[index]` use in server streaming is
  not the old browser interpreter.**
- Any change is a staged migration with per-consumer tracing and exit
  conditions, not a global deletion. The consumer map is maintained in
  [the current-reality audit](./alpha16-18-current-reality.md) and
  [the cleanup inventory](./alpha16-18-cleanup-inventory.md).

### 4.2 One client execution backend, independent server rendering backend

There is exactly **one client execution backend** for the component model: one
semantic model, one ownership/identity model, one signals engine, one generated
execution shape, one ABI.

There is exactly **one independent server rendering backend**, producing HTML/DSD
from the same semantic model. It is not a variant of the client backend and does
not share an execution protocol with it.

- **Two client execution backends are prohibited.** A second renderer, or a
  legacy client path kept alive for compatibility, is out of scope permanently.
- **The independent server rendering backend remains valid and necessary.** Its
  existence is not a violation of P5.
- There is one authoring frontend going forward (functions); the class frontend
  is a migration input that retires in Alpha16b, not a parallel adapter design.

### 4.2a Alpha16a / Alpha16b release split (owner-approved D-O1)

**Alpha16a — internal foundation.** Build the compiler-native execution model,
introduce the new generated path, keep the existing generic executor for
capabilities not yet migrated, prove the leaf and stateful foundations, complete
the applicable G1/G2 evidence. Alpha16a is **internal engineering progress**: no
public version, tag, publication, or default-Starter promise follows from it,
and it is not permission to ship two execution models.

**Alpha16b — Alpha16 release qualification.** Complete migration of all required
browser execution capabilities, generated mount/update/claim/disposal, retirement
of the class frontend (no adapter is built), Router integration, packed-consumer
qualification and browser/server qualification; prove the old generic browser executor is
unreachable from every applicable production browser entry graph; complete
behavioural coverage for migrated capabilities.

**The ADR-0174 hard gate remains intact.** If the old generic browser executor
remains reachable, Alpha16 does not qualify for formal release. The gate concerns
the old generic **browser execution path** — not the deletion of every Part
Program artifact or every server-side consumer.

### 4.3 Function components and hostless composition

A function component is a logical component, not necessarily a DOM element. It
may own signals, props, children, effects, cleanup, one or more roots, empty
output and logical identity. Internal composition does not require a Custom
Element host.

Custom Elements remain first-class for native interop, independent controls,
slots/shadow, form association, third-party components and island activation.
Not every internal component becomes an element.

### 4.4 Full TSX and JSX values

Full TSX is the authoring target, not a restricted template language. It does
not mean arbitrary JavaScript values are valid DOM children: null/undefined/
booleans, numbers, strings, arrays/iterables, functions, promises, async values,
objects and JSX values each need defined semantics and diagnostics.

A JSX value in value position is a **lazy, compiler-recognized insertion
recipe** — not a VNode, not a mounted region. Repeated consumption creates
independent instances unless an explicit API says otherwise. Evaluation timing,
lexical capture, props read/update, ownership per insertion, cross-owner
projection, failure behaviour and disposal are specified in
[the JSX model](./jsx-value-and-children-model.md); unresolved items there are
marked OPEN, not silently settled.

**JSX runtime entry is not the recipe mechanism.** `jsx-runtime.ts` /
`jsx-dev-runtime.ts` keep only two jobs: they make TSX typecheck, and they fail
closed when JSX reaches runtime without compilation
(`packages/element/src/jsx-runtime.ts:20-53`). Alpha16's JSX recipes are a **new
compiler output semantics**, not a revival of those factories: a recipe is
emitted by the compiler and carries no runtime tag/type dispatch. The guard stays,
and it must keep failing closed after recipes exist.

### 4.5 Ownership and lifetime

Reuse `LifetimeScope`. It already provides parent/child scopes, LIFO cleanup of
`add()` callbacks (child scopes are visited in **insertion order**, not LIFO),
per-scope error isolation, idempotent disposal, an abort signal and range
cleanups (`packages/element/src/internal/compiled/lifetime-scope.ts:4-109`).

Binding rules:

- every component instance and every insertion projection has exactly one owner;
- disposal order is children first (insertion order), then the owner's own
  cleanups LIFO, with one failing cleanup not cancelling the rest;
- `dispose(true)` is full disposal **plus** range cleanup, not a DOM-only detach;
- **disposal and DOM detachment are different operations** and must not be
  conflated;
- no second owner system and no generic Region interpreter; "region" stays a
  semantic concept realised by generated boundaries and direct references.

### 4.6 SSR, DSD and Claim

Server and client share semantic meaning but need not share execution
implementation: server codegen emits HTML/DSD, client codegen emits
mount/claim. Claim is qualified separately for node and component identity,
text/attribute correctness, DSD, user-edited form state, DOM preservation,
mismatch diagnostics, cleanup and bounded recovery. Replacing the client
executor does not automatically solve SSR or claim.

### 4.6a Async server components (Alpha16 scope)

The current compiler **rejects** `async` server function components with
`OEC9032` and requires a single synchronous JSX return
(`semantic-core/server-component.ts:135,173-175`). The target must be defined
explicitly rather than assumed:

| Question | Alpha16 position |
| --- | --- |
| Are ordinary async server components supported? | **Yes, as a defined milestone (M14), not as current behaviour.** |
| How is output produced? | **Full-await:** the component awaits its data, then returns its JSX; HTML is emitted after all awaits complete. No out-of-order or per-fragment streaming in Alpha16. |
| Does server-only code reach the client graph? | No — the existing server-only import guard (#1618) remains the enforcement point; unmigrated async work must not add a second path. |
| Which milestone owns it? | M14, parallelisable, required for Alpha16b qualification. Not part of the Alpha16a gate. |

Bounded defer, cancellation and streamed regions are **Alpha18**, not this.
Ordinary `await` and deferred regions are different capabilities and must not be
conflated in planning or tests.

### 4.7 Class authoring — current fact and approved retirement

**CURRENT FACT:** the only shipping authoring path is the decorated class
(`@element`, `class X extends OpenElement`); the 2026-11-03 baseline recorded 219
in-tree files matching `@element(`. That figure is a historical size metric, not
a current precise count; the migration inventory is re-taken at execution.

**APPROVED (2026-11-03, fourth pass):** retire the public Class/Decorator
authoring API and do **not** build a compatibility adapter. Keep native Custom
Elements as the public platform boundary, and keep an internal generated class
where the platform requires an element. Authors no longer extend
`OpenElement`; whether a **non-authoring** export of that symbol is still needed (internal
use, tooling, or nothing at all) is an implementation question — it is no longer
an author-facing API either way.

**SUPERSEDED HISTORY (2026-11-03 D-O3):** the earlier decision was a long-lived
adapter. It is superseded by the approved fourth pass and retained as history; the
cost evidence behind the change is in
[the reassessment](./alpha16-18-fourth-pass-reassessment.md) §2.

The approved decision is made, so the statement is unconditional:

- `OpenElement` is **no longer an author-facing class base**. Authors do not
  extend it and do not write `render()`.
- The compiler may still emit an internal class extending a framework-internal
  base where the platform requires an element (island root, registration, native
  interop). That internal base is not a public authoring API.
- No compatibility adapter is built, so there is no adapter path to keep honest
  and no second frontend to test. The class authoring path remains the migration
  input until Alpha16b retires it; its per-file/capability evidence is M10
  partition evidence, not the M09 CE boundary.

The constraint that does not move: **one semantic model and one generated client
execution backend**, plus one independent server rendering backend, never two
execution architectures.

### 4.8 Lit retirement is a separate track

Recorded in ADR-0152's 2026-11-03 amendment and executed by the 2026-11-08 owner
ruling: OhMyLit is terminated and the first-party Lit renderer is retired
zero-compat — no compatibility adapter, dual renderer lane or migration interval
exists, and the current source line no longer ships it. Third-party Lit Web
Components stay available client-side, without automatic SSR or Lit DSD hydration
guarantees. Lit retirement did not gate Alpha16 and must not be smuggled into it.

### 4.9 Rust is a post-Alpha18 track

After semantics, IR, ABI, codegen, source maps, diagnostics, test corpus and
compiler benchmarks stabilise, a Rust compiler PoC may implement the same
semantics. It is not an Alpha16 prerequisite and does not touch the browser
runtime.

## 5. Non-negotiable constraint check

Before adding any abstraction, runtime layer, protocol or compatibility
mechanism, answer in the proposing document:

1. Which existing responsibility does it replace or extend?
2. Can the compiler, signals, `LifetimeScope` or DOM primitives already solve it?
3. Does it create a second execution model?
4. Does it move a compile-time decision back into runtime?
5. Does it introduce an unnecessary generic interpreter?
6. Can the compiler generate the behaviour directly?
7. What is the migration and cleanup path?
8. What test or source evidence proves it is necessary?
9. Who owns it, what is its scope, and what is its retirement condition?

An addition that cannot answer all nine is not ready.

## 6. Canonical vocabulary

| Term | Meaning | Not to be confused with |
| --- | --- | --- |
| component instance | logical component with identity, props, owner and region | a DOM element |
| owner | `LifetimeScope` node owning resources for an instance/projection | the DOM node |
| region | the DOM range one instance/projection owns | a generic runtime object |
| mount recipe | compiler-emitted lazy insertion description for a JSX value | VNode |
| props | read-only tracked input record | a signal |
| claim | attaching generated code to server-produced DOM | re-render |
| Part Program | current structural artifact; transitional | the target execution protocol |
| metadata | identity/tag/properties/routing facts | execution structure |
| generated ABI | the contract between generated modules and helpers | the wire protocol |

## 7. What this document does not claim

- It does not claim any item above is implemented.
- It does not freeze names, types or the ABI.
- It does not authorise deleting the Part Program, the old executor or the class
  API; the Lit renderer retirement is a separate ADR-0152 track.
- It does not promise dates or performance outcomes.
