# Compiler-native architecture (canonical)

Date: 2026-11-03. Status: **ACCEPTED IN DIRECTION** — the destination is fixed
by the owner; every implementation detail below is unverified until its gate
produces evidence. Baseline: `4f1f2001b24909086f7e7efe9e5016d48d615c91`.

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

### P5 — One generated backend

Class authoring and function authoring may have different frontend adapters, but
they converge on **one** generated execution backend. A permanent
`class → old Part runtime` plus `function → new runtime` split would be two
frameworks and is prohibited. Retiring the class authoring API later is a
separate product decision with its own evidence.

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

### 4.1 Part Program is transitional, in four distinguishable roles

Today's `__partProgram` is not one thing. Its roles must be separated before
anything is removed:

1. **compile-time structural representation** — analysis/lowering input;
2. **browser execution protocol** — the thing P2 retires;
3. **SSR/serialization input** — the server serializer reads root kind, parts and
   metadata to emit HTML (evidence: `packages/element/src/public-runtime.ts:725-790`);
4. **metadata and identity** — tag, version, properties, routing detection
   (evidence: `packages/element/src/public-runtime.ts:222,378,419`,
   `packages/router/src/authoring.ts:442`,
   `packages/router/src/vite/internal/server-runtime/stream-runtime.ts:523-525`).

Consequences that are binding:

- Do not delete the Part Program, its validator, or `__partProgram`.
- Do not remove metadata merely because the browser stops interpreting structure.
- Do not break Router or SSR consumers.
- A compile-time IR may survive the retirement of the browser protocol.
- Any change is a migration with per-consumer tracing, not a global deletion
  (see [the cleanup inventory](./alpha16-18-cleanup-inventory.md)).

### 4.2 One generated backend

Class and function components share: the semantic model, identity and ownership
semantics, signals, the generated execution shape, SSR serialization path, and
the ABI. They may differ in their **frontend adapter** (decorated class vs
function) and in authoring-visible sugar. Two execution backends are out of
scope permanently.

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

### 4.5 Ownership and lifetime

Reuse `LifetimeScope`. It already provides parent/child scopes, LIFO cleanup,
per-scope error isolation, idempotent disposal, an abort signal and range
cleanups (`packages/element/src/internal/compiled/lifetime-scope.ts:4-109`).

Binding rules:

- every component instance and every insertion projection has exactly one owner;
- disposal order is children-then-own, LIFO, with one failing cleanup not
  cancelling the rest;
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

### 4.7 Class compatibility

Existing class/decorator authoring keeps working through the shared backend and
a compatibility adapter. It is not a permanent parallel renderer. Eventual
retirement of the class API is a separate product decision.

### 4.8 Lit retirement is a separate track

Recorded in ADR-0152's 2026-11-03 amendment: OhMyLit is terminated, first-party
Lit renderer retirement is initiated, alpha.15 support remains, and the
last-supported version, breaking release, compatibility window and security
owner are **OPEN**. Third-party Lit Web Components stay available client-side.
Lit retirement does not gate Alpha16 and must not be smuggled into it.

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
- It does not authorise deleting the Part Program, the old executor, the class
  API or the Lit renderer.
- It does not promise dates or performance outcomes.
