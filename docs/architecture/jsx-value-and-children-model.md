---
status: active
topic: JSX values and repeatable children
summary: Mount recipes, evaluation timing, the owner/region model and the disposal contract.
---

# JSX values and repeatable children: execution model

Date: 2026-11-03. Status: **CANDIDATE DESIGN / NOT IMPLEMENTED**. Baseline:
`4f1f2001b24909086f7e7efe9e5016d48d615c91`.

Revised 2026-11-05: props-getter evaluation is **decided per-read** as owner
semantics (§4.2a); that is a policy decision, not implementation or verification.
The async/defer scope item in §8 is corrected; reconnect resource revival (§4.1d)
and dual-backend observable parity (§4.7) are recorded as OPEN obligations with
named owning milestones.

This note answers one question the Alpha16–18 contract cannot proceed without:
what a JSX expression produces at runtime, and how one such value can be
inserted more than once without becoming a shared DOM region.

It is an architecture decision for review, not an ABI. Helper names, module
layout and type spellings below are illustrative and **not frozen**. Nothing in
this document exists in the repository today; every claim about current
behaviour cites the implementation.

## 1. What exists today

JSX has no runtime representation. `packages/element/src/jsx-runtime.ts` exists
only so TSX typechecks, declares `JSX.Element` as an uninhabited nominal type
(`jsx-runtime.ts:44-53`), and every factory throws `JSX_OUTSIDE_COMPILER`
(`jsx-runtime.ts:20-42`). The compiler lowers JSX into Part Program tree nodes
and never emits a JSX value (`compile.ts:109-186`).

Composition is therefore limited in two concrete ways:

- A compiled class component's `render()` must be a single return of one
  intrinsic element (`compile.ts:141-152`); fragments at the root are rejected
  (`lower-program.ts:450-465`, `lower-program.ts:818-820`).
- Nested function composition exists only in the server lane, where an
  uppercase tag lowers to a direct call of the imported binding that returns an
  HTML string (`server-component.ts:1-33`, `:186-215`). That is eager
  string composition, not an instance model.

The elements that a repeatable-value model must build on already exist:

| Primitive | Where | What it provides |
| --- | --- | --- |
| Owner tree | `lifetime-scope.ts:4-26` | parent/child scopes, attach refuses a disposed parent |
| Idempotent disposal | `lifetime-scope.ts:83-109` | child-then-own ordering, one failing cleanup does not stop the rest, first error rethrown |
| Range cleanup | `lifetime-scope.ts:63-69` | removing the nodes one region owns |
| Keyed entries | `runtime/blocks.ts:119-152` | `EachEntry { key, scope, nodes, item, itemBox }` plus `byKey` |
| Live item for keyed reuse | `runtime/blocks.ts:175-190`, `:204-224` | `itemBox` read at dispatch time so a reused entry keeps current data and current event handlers |
| Region builder/updater | `runtime/blocks.ts:246`, `:356`, `:599` | `buildWhen/updateWhen`, `buildEach/updateEach` |

`itemBox` matters for this design: the repository already accepts that a keyed
reuse must keep the DOM and the instance while changing the data a handler
reads. Props replacement (TSX-04) is the same problem one level up.

## 2. Requirements

From the owner-approved direction:

1. `const c = <Counter />` then `{c}{c}` creates **two** instances: two owners,
   two signal sets, two DOM regions, two cleanups.
2. Repeated children projection creates independent subtrees.
3. No public VNode ABI, no generic browser interpreter, no `cloneNode` of a
   mounted DOM region.
4. Lexical dependencies stay those of the **definition site**; cleanup
   ownership belongs to the **projection site**.
5. Ordinary JavaScript in a function is a snapshot; explicit `computed` is
   reactive; a computation written directly inside a JSX dynamic expression is
   tracked by the compiler.
6. The same model must serve SSR, fresh mount, claim, update and dispose.

## 3. Rejected models

**Public VNode / element descriptor.** A tagged data object (`type`, `props`,
`children`) resolved at runtime is a small VDOM. Rejected: it reintroduces
runtime type dispatch and a generic reconciliation entry point, and it makes
the compiler's static knowledge optional rather than authoritative.

**Eager creation at value evaluation.** If `<Counter />` immediately allocated
an owner and DOM, the value would be a mounted region; inserting it twice means
either sharing one region (rejected) or moving it (state loss, platform
callbacks). It also allocates for values that are never inserted.

**`cloneNode` duplication.** Copies DOM without instances, signals or
subscriptions; the two copies would diverge on the first update. Rejected.

**A second renderer keyed by strings.** Reintroduces tag-name dispatch and a
parallel execution path that is not compiled per site.

**Closure-backed template + clone (Solid-style) as the *semantic* model.** A
`<template>` clone per instance is a legitimate *implementation detail* for an
intrinsic subtree, but it cannot express component children, server execution,
or props replacement. It is not the contract.

## 4. Recommended model: compiler-emitted mount recipes

A JSX expression that appears in **value position** (bound to a local, passed
as an argument, returned from an ordinary function, stored in an array) is
lowered to a **mount recipe**: a compiler-generated closure.

```text
recipe(owner, parent, before) -> Node[]      // illustrative signature
```

It is opaque, non-serializable, has no type tag, and is not part of the public
API surface. It is created without touching the DOM and without reading any
signal.

Author view:

```tsx
function App() {
  const counter = <Counter step={step.value} />;
  return <>{counter}{counter}</>;
}
```

Emitted shape (conceptual; helper names unfrozen):

```js
import { insert, component } from '<internal generated runtime>';

function App(__owner) {
  // Creation: allocates one closure. No DOM, no instance, no signal read.
  const counter = (__o, __parent, __before) =>
    component(__o, __parent, __before, Counter__mount, () => ({
      get step() { return step.value; },
    }));

  // Two insertion sites: each creates its own owner and its own instance.
  return [
    /* slot 0 */ (__o, __p, __b) => insert(__o, counter, __p, __b),
    /* slot 1 */ (__o, __p, __b) => insert(__o, counter, __p, __b),
  ];
}
```

An earlier draft claimed `insert` was the **only** new runtime primitive. That
claim is withdrawn: it was made before the disposal and ownership questions below
were worked through.

What the model actually needs, and what already exists:

```js
// Prototype form — ILLUSTRATIVE, and deliberately incomplete.
function insert(owner, recipe, parent, before) {
  const scope = owner.child();          // projection-site owner (exists)
  const nodes = recipe(scope, parent, before);
  scope.addRangeCleanup(() => removeNodes(nodes));
  return nodes;
}
```

| Requirement | Status | Evidence |
| --- | --- | --- |
| child owner | exists | `LifetimeScope.child()` (`lifetime-scope.ts:28-30`) |
| deferred range removal | exists | `addRangeCleanup` (`lifetime-scope.ts:63-69`) |
| removal actually triggered | **must be decided by the caller** | see §4.1a — a range cleanup only runs under `dispose(true)` |
| definition-owner liveness check | **new internal check required** | `LifetimeScope` exposes `disposed`/`active` (`:32-38`) but no identity or provenance |
| projection-owner ancestry check | **open** — needs an internal token or query | parent link is private (`#parent`, `:5`) |
| exception-safe partial rollback | **new code required** in generated mount | §4.1b |

So the honest statement is: **`insert` is a compiler-emitted call site, not a
proven single primitive.** Whether it is one function, a small internal object, or
generated inline code is OPEN and is decided by the test obligations in §9, not by
this document.

### 4.1 Why this is not a VDOM

- The recipe closes over a **statically known** mount function
  (`Counter__mount`), fixed at compile time. There is no runtime resolution of
  a component from a value.
- There is no tree to diff. Insertion is an imperative create at a known site.
- The recipe has no inspectable shape, so no generic walker can traverse it.
  Any consumer must call it, which requires an owner — i.e. the semantics are
  enforced by the type of the primitive, not by convention.

### 4.1a Disposal versus detachment (must not be conflated)

`LifetimeScope.dispose(detachOwnedNodes = false)` is not a single operation. The
real semantics, read from the implementation:

| Call | What runs | What survives |
| --- | --- | --- |
| `dispose()` | abort signal, child scopes **in insertion order**, then registered `add()` cleanups **LIFO** | range cleanups **do not run**; owned DOM stays in place |
| `dispose(true)` | everything above **plus** `addRangeCleanup` callbacks (also LIFO) | owned DOM range is removed |

Evidence: `lifetime-scope.ts:83-109` (the `if (detachOwnedNodes)` guard around
range cleanups), and the two production call sites that use detach mode —
`blocks.ts:312` (`block.branchScope.dispose(true)` when a when-branch is
replaced) and `blocks.ts:516` (`entry.scope.dispose(true)` when a keyed entry is
deleted). Ordinary disconnect uses plain `dispose()` precisely so DOM can be
reclaimed on reconnect.

Therefore every situation needs its own row, and the prototype `insert` above
gets the last one **wrong** if copied literally:

`dispose(true)` is **not** a DOM-only detach: it performs the complete scope
disposal (abort signal, children in the same mode, `add()` cleanups LIFO) and
*additionally* runs the `addRangeCleanup` callbacks. The earlier draft called it
"DOM range detachment only"; that naming was wrong and is corrected here.

| Situation | Call | What it does |
| --- | --- | --- |
| Component/resource disposal (owner leaves the tree) | `dispose(true)` on the owner | full disposal **plus** removal of the owned DOM range |
| Branch replacement / keyed deletion (region removal) | `dispose(true)` on the branch/entry owner | full disposal plus range removal; existing precedent `blocks.ts:312,516` |
| Parent owner disposal | `dispose(true)` cascades to children | still-live children inherit the mode (`lifetime-scope.ts:100`); a child already disposed with the plain flag is not upgraded |
| Independent projection deletion | `dispose(true)` on that projection's owner only | sibling projection must stay live |
| CE disconnect / suspend (DOM retained for reconnect) | plain `dispose()` | full disposal **except** range cleanups; owned DOM stays in place for revive |
| "Detach DOM without disposing resources" | **does not exist** in this API | treat as unsupported; do not emulate it by calling `dispose(true)` early |
| Failed setup rollback | `dispose(true)` on the partial scope | partial DOM must not survive (§4.1b) |

**Do not change the default `dispose()` behaviour to make an example work.** The
default is load-bearing for disconnect/reconnect and revive
(`runtime/revive.ts`), and changing it is a separate decision with its own
evidence.

### 4.1b Exception-safe setup and insertion

The prototype registers a range cleanup only *after* `recipe()` returns. If a
generated mount throws, the partially built region has no registered removal.
The contract must therefore be:

1. **The child scope exists before the first node is created**, so every
   subsequent resource registers on a scope that can be disposed.
2. **Every acquired resource registers as it is acquired** — node ranges,
   signal subscriptions, event listeners, nested owners — not in one batch at
   the end.
3. **On failure, the inserting code disposes that scope with detach mode**,
   which removes any partial DOM range and releases subscriptions/listeners.
4. **Nested component setup failures propagate** after the inner scope has
   rolled back; the parent decides whether its own boundary recovers.
5. **The original error is preserved.** Cleanup errors are attempted and
   suppressed; the construction error is what surfaces (the same first-error
   discipline as `LifetimeScope.dispose`, `:88-108`).
6. **No orphan region and no double ownership**: a scope that failed setup is
   never attached to a live parent as a functioning region.

This matrix is the mount and insertion path (`insertRecipe` rolls back with
`dispose(true)`). Claiming borrowed DOM is not this matrix: `claimRecipe`
rolls back with `dispose(false)`, which releases resources without deleting
the borrowed nodes and without restoring bytes written before the throw.
Successful claim input, focus and selection preservation is unchanged
(TSX-18). Whole-region byte rollback of a claim would be a separate design.

Failure matrix that the implementation must satisfy explicitly:

| Failure point | Required behaviour |
| --- | --- |
| before the first node exists | nothing to remove; error surfaces |
| after partial DOM creation | partial range removed by the rollback |
| after signal subscriptions | subscriptions released; no writes to a dead region |
| after event listeners | listeners removed |
| during insertion into the parent | already-inserted nodes removed; parent unchanged |
| during nested component setup | nested scope rolled back first |
| inside one cleanup while others remain | remaining cleanups still attempted; first error surfaces |

### 4.1c Owner lineage and cross-owner projection

The approved contract says lexical dependencies belong to the definition site,
ownership to the projection site, and projection must stay inside the defining
owner's subtree in Alpha16. The prototype gives the runtime **no way to check
that**, because `LifetimeScope` keeps its parent private (`#parent`,
`lifetime-scope.ts:5`) and exposes only `disposed` / `active` (`:32-38`).

Required checks, and what is missing today:

| Check | Available today | Needs |
| --- | --- | --- |
| definition owner still alive | `owner.disposed` | nothing new |
| projection owner still alive | `owner.disposed` | nothing new |
| projection owner is a permitted descendant of the definition owner | **nothing** | an internal lineage token or an ancestry query |
| delayed insertion after definition owner disposal | partial: disposal is observable, association is not | the same lineage mechanism |
| two insertions produce two independent owners | achievable | nothing new |

Design constraint for whatever mechanism is chosen: it must stay **internal**
(no public owner API), must not turn `LifetimeScope` into a general graph
service, and must cost nothing on the hot path when no projection crosses a
boundary. Options to evaluate — an immutable lineage token carried by the
recipe, a definition-owner stamp checked at insertion, or a compiler-emitted
`assertSameTree` guard — are **OPEN** and decided by the TSX-26 test, not here.

What must not happen: silently allowing a cross-subtree projection and then
disposing it with the wrong owner, or leaking a "projection of a dead owner"
into the DOM.

### 4.1d Reconnect and resource revival (OPEN)

**CURRENT FACT.** The disconnect path in §4.1a calls plain `dispose()` with the
default flag. That disposes the **resource owner**: it aborts the owner signal,
disposes child scopes in insertion order and runs `add()` cleanups LIFO. It does
**not** remove the owned DOM, because range cleanups are deliberately skipped
(`lifetime-scope.ts:83-109`). So disconnect today means "dispose the owner's
resources, retain the DOM", not "leave the owner detached and undisposed".
`reviveOwnedDom` verifies that retained DOM and constructs a **fresh** root
`LifetimeScope`, re-arming the retained bindings
(`runtime/revive.ts:326-330`; the revive path depends on exactly this non-detach
behaviour).

Two events must not be conflated:

- **Claim activation** (`TSX-18`): the server-authored nodes already exist and
  are activated in place. Its DOM/input/focus/selection fidelity is an existing
  claim contract and is not evidence about platform reconnect.
- **Platform disconnect/reinsert** (this section): the platform removes and
  reattaches nodes on its own schedule. The framework does not control that move,
  so focus behaviour is a platform property, not a framework promise.

The author-facing contract states the other half — `onConnect` may run again
after reconnect and setup does not re-run
([TSX-14](./tsx-author-candidate-contract.md); candidate, target not observed) —
and that "disconnect releases connection resources". The resource-level contract
between those statements does not exist yet. Neither document states, for a
recipe child or a hostless child owner:

- how its private signals survive the disconnect window (if they do not,
  "setup does not re-run" is not true);
- how its props getters keep reading the defining scope after the child owner's
  resources are disposed and before revive;
- how DOM bindings and listeners released on disconnect are rebuilt on
  reconnect without re-running setup, and whether that rebuild is idempotent;
- whether a logical subscription is re-created or only re-suspended, and which
  fixture-level baseline graph the reconnect must reproduce;
- whether any physical owner/scope identity is preserved; `revive.ts:326`
  creates a new root scope today, so a surviving scope object is not current
  behaviour;
- whether a hostless child owner with no DOM of its own has a connection
  concept at all.

These are **OPEN**. Owning stage: **M05–M09** in
[the execution plan](./alpha16-18-execution-plan.md), at the point where generated
lifecycle, Claim and Native CE-boundary evidence are produced; M07–M08 are where
the retained-DOM/disposed-owner difference is actually exercised, and M09 is the
connected Custom Element boundary where a platform reconnect can occur. The
callback names (`onConnect` / `onDispose`) may stay OPEN until Alpha17, but
**resource persistence semantics must not be deferred with the names**: a naming
decision cannot leave setup-once-and-reconnect undefined.

Acceptance evidence — probes, not generated-source snapshots:

| Obligation | Evidence |
| --- | --- |
| setup does not re-run on reconnect | setup count per logical instance stays exactly 1 across disconnect → reconnect |
| logical instance continuity | the same logical instance is resumed with its setup result and private state; a physical `LifetimeScope`/child-scope object identity is **not** asserted (fresh scope today; resource-scope identity is OPEN) |
| expected subscription graph reproduced | the fixture's declared logical subscriptions before disconnect are present exactly once after reconnect: no duplicate and no loss. Counts are per fixture; a dynamic branch may legitimately hold zero or several subscriptions, so a universal count of 1 is not an acceptance criterion |
| private state survives | a signal written before disconnect reads the same value after reconnect; the framework adds no reset to a live input's value |
| retained DOM/input is not additionally destroyed | the framework leaves the platform-retained DOM and user input/selection untouched and does not rebuild the region; the test asserts only that the framework adds no loss |
| platform focus differences are recorded | blur/focus/move behaviour observed across a real detach/reinsert is recorded as a **platform difference**, not a pass/fail promise; no focus restoration API is invented |
| release is real | after disconnect the released resources are gone; after reconnect each expected resource exists exactly once |

This is a **target contract in the making, not current behaviour**: no
implementation today proves these rows, and nothing here may be claimed until
the probes exist. No new public API is proposed; whether revival needs an
internal registration hook is part of the OPEN set. In particular, this section
does **not** freeze whether a future implementation reuses a scope object or
keeps creating a fresh one; it fixes only the logical persistence obligations
above.

### 4.2 Evaluation timing

This is the semantic decision authors will notice, so it must be explicit:

| Moment | What happens |
| --- | --- |
| Recipe creation (the JSX expression evaluated as a value) | closure allocated; lexical bindings captured; **no** DOM, **no** instance, **no** signal read, **no** user expression executed |
| Insertion | child owner created; optional key thunk read; component setup runs **once** for this instance; props getters close over the defining scope |
| Update | effects whose tracked reads changed re-run; setup does not re-run; instance identity preserved |
| Disposal | the projection-site owner disposes: child scopes in insertion order, then own cleanups LIFO; one throwing cleanup does not stop the rest |

Consequence to accept explicitly: a props expression such as
`<Counter step={next()}/>` is evaluated **per read of the getter** — not once at
creation and not once per insertion (§4.2a). Two insertions of one recipe may
therefore observe different prop values if the captured state changed between
them, and one instance may observe a different value on a later read. This
differs from React, where the element object snapshots props once. It is the
price of independent instances and it must be tested, not discovered.

### 4.2a Observable evaluation contract

The timing table above is not precise enough to implement or test. The exact
contract, with decided parts labelled and open parts named:

| # | Situation | What evaluates | Count |
| --- | --- | --- | --- |
| 1 | Recipe creation (`const c = <Counter step={next()} />`) | nothing authored runs; only a closure is allocated | `next()` **0 times** |
| 2 | Initial insertion | props getters are created; a getter body runs when the child reads it | `next()` runs once per child read, inside whatever tracking context performs the read |
| 3 | Tracked prop dependency update | the getter runs again on each read performed by a dependent binding | once per read; a binding that reads it k times in one evaluation runs it k times, so a single update may run it several times |
| 4 | Keyed prop replacement | the backing value is replaced; dependent bindings re-run | getter runs on each read during re-evaluation, not on replacement itself |
| 5 | Destructuring (`const { step } = props`) | getter runs once during setup | exactly once, snapshot |
| 6 | Event dispatch | handler body runs; prop reads inside it run then | per read inside the handler, not once per dispatch |
| 7 | SSR initialization | setup once, getters as read during serialization | per serialization read; SSR-only reads are phase-specific and need not equal client counts |
| 8 | Client initialization | setup once | per client instance |
| 9 | Claim | setup once; the fixture's expected logical subscriptions are established once | setup 1; each expected logical subscription appears once — no duplicates, no loss; a dynamic branch may legitimately have zero or several, so no universal count of 1 |

**M09-2c phase-labelled addendum (client-only channels).** Rows 7–9 keep the
same phase-specific rule for the generated element's intrinsic `onClick` /
`ref` channels: a local setup resource reachable ONLY from a client-only
event/ref attribute is pruned from the SSR producer (the client mount/claim
sets it up; the server never evaluates it), while every local expression the
server output does read is still evaluated once, in authored order. The
contract is asserted as phase-labelled counts, never forced equal: a
handler-only setup side effect is **0 in SSR** and **1 per client mount/claim**;
a surviving local's side effect is 1 in SSR too and keeps its authored order.
The tracked record and tests are
[`m09-2c-intrinsic-event-ref.md`](./m09-2c-intrinsic-event-ref.md).

The consequence authors will notice is row 2 + 3: `step={next()}` is **not**
evaluated once when the JSX value is created. Two insertions can observe
different values if captured state changed between them, and a side effect in a
props expression runs per read rather than per element. That is a deliberate
consequence of independent instances plus tracked getters, and it is tested by
TSX-28 rather than left to documentation.

**APPROVED (owner ruling; semantics, not implementation): props getters evaluate
per read.** Every read of a props getter runs the getter body again, in the
reading context. There is no
per-update-tick value cache, no per-binding cache, and no de-duplication across
bindings. Row 3 above is the exact count and is part of this decision, not an
independent choice.

Consequence, stated so it cannot be optimized away silently: **any memoisation
that changes the number of evaluations, the value returned, or the order of
side effects is not an equivalent optimization.** It is a semantic change and
needs a new owner ruling with its own evidence. "Cheaper" is not a compatibility
argument.

**SUPERSEDED HISTORY:** an earlier revision of this section recorded
"memoised per update tick when read by several bindings, or evaluated once per
binding" as OPEN and asserted that both were compatible with the author-visible
contract. That claim is withdrawn: the two differ observably — in evaluation
count, in the value a side-effecting props expression returns, and in the order
of those side effects relative to other reads. The decision in force is per-read.

TSX-28's job is therefore **verification, not selection**: lock the evaluation
count for creation, insertion, update, keyed replacement and claim, and record
the measured cost of per-read evaluation. A cost record that suggests a cache
returns to this decision; it does not overturn it.

Known sharp edge, to be documented rather than hidden: because evaluation is per
read, a non-idempotent props expression (`<X v={counter++} />`) is order- and
count-dependent by construction. Options are a dev-mode warning or a documented
rule that side effects belong in handlers/effects. This is OPEN; it must not be
silently allowed to differ between mount and claim.

### 4.3 Props are getters over the defining scope

`props` inside a component is a compiler-emitted record of getters:

```js
Counter__mount(scope, props) {
  // props.step is a getter: it reads step.value in the caller's scope
  // every time, inside whatever tracking context performs the read.
}
```

That single choice satisfies three approved requirements at once:

- **TSX-03**: `props.value` is tracked because the read happens inside an
  effect; `const { value } = props` invokes the getter once during setup and is
  a snapshot by ordinary JavaScript semantics. No React-style prop object, no
  hidden proxy, no per-prop subscription boilerplate.
- **TSX-04**: keyed reuse updates the backing value behind the getter; existing
  effects re-run and read the new item; event handlers that read `props.item`
  at dispatch time see the new value — the same invariant `itemBox` already
  enforces for list entries (`blocks.ts:204-224`).
- **TSX-05**: a dynamic JSX expression is compiled into a tracked closure
  evaluated in an effect, so `{props.items.filter(i => i.name.includes(q.value)).length}`
  re-runs only that expression, not the component body.

Tracking granularity is an OPEN implementation choice: one props-version signal
per instance (simple, coarse) versus per-property signals (fine, more objects).
Recommendation: start coarse, and only split once G3 evidence shows a real cost.
This choice is about **which reads are invalidated**, not about caching values:
under the approved per-read decision (§4.2a) every read still evaluates the
getter, so a variant that returns a cached value per version is a different
semantic, not a granularity option.

### 4.4 Children are recipes too

`children` is not a DOM fragment and not a pre-evaluated array. It is a recipe
passed as a prop:

```tsx
<Frame><Counter /></Frame>
```

```js
create(Frame__mount, () => ({ get children() { return () => create(Counter__mount, () => ({})); } }))
```

`Frame` may therefore project `props.children` at more than one site:

```tsx
function Frame(props) {
  return <><section>{props.children}</section><aside>{props.children}</aside></>;
}
```

Each `{props.children}` is an insertion site: its own child owner, its own
`Counter` instance, its own signals, its own cleanup. Deleting one projection
leaves the other intact.

Two rules keep this honest:

1. **Lexical dependencies belong to the definition site; ownership belongs to
   the projection site.** The recipe's closure reads the defining component's
   locals, but the instance it creates is disposed by whoever projected it.
2. **A projection must stay inside the defining owner's subtree.** Projecting a
   recipe into a different owner tree (teleport, cross-root portal) is out of
   scope for Alpha16 and must be rejected with a coded diagnostic rather than
   silently producing an instance that outlives its dependencies.

### 4.5 Ordinary functions are not render callbacks

```tsx
function RenderLabel(props) { return <div>{props.render('A')}</div>; }
```

`props.render` is a normal function. It is not converted into a recipe and it
is not invoked implicitly. It runs only where the author calls it, and whatever
it returns is inserted at that site (TSX-10 negative case). This is why the
recipe must be produced by the compiler at a JSX site, not by "any function
returning JSX".

### 4.6 Keys

A keyed list needs keys **before** instantiation, so a recipe whose element
carries `key` also carries a key thunk evaluated at plan time:

```js
const row = (__o, __p, __b) => component(__o, __p, __b, Row__mount, () => ({ get item() { return box.item; } }));
const rowKey = () => box.item.id;
```

`buildEach`/`updateEach` (`blocks.ts:356`, `:599`) already own the `byKey` map
and the entry lifecycle; the recipe model changes what an entry mounts, not how
entries are matched. Key scope, duplicate-key rejection and unkeyed positional
rules remain as specified in the contract (TSX-07/TSX-08).

### 4.7 SSR, mount, claim

**Shared semantic model, not necessarily shared executable code.** Server and
client may use different codegen backends; what must match is *meaning*:
instance identity, insertion order, props values, ownership and cleanup — not a
single byte-identical module. An earlier draft said "the same generated code must
serve all three", which is stronger than the architecture requires and would
force a runtime host abstraction that the target explicitly avoids.

**Shared IR is not shared semantics.** Emitting the server and client output
from one semantic IR does not make the two observably equivalent, and no IR
property implies it. The obligation is behavioural and **phase-labelled**: for
the same authored input, assert what each phase promises — evaluation counts
against the §4.2a row for that phase (SSR-only reads are legitimately
phase-specific and must be documented, not forced equal to client counts), DOM
structure and attributes, SSR seed state versus post-claim state, claim
marker/key/order, bounded recovery, and error propagation (diagnostic identity and
authored location). M06 (fresh mount) and M08 (SSR→claim) produce the compared
results; M07 is the leaf-claim prerequisite; M13 qualifies the browser/server
behaviour. That is an acceptance obligation in
[the execution plan](./alpha16-18-execution-plan.md), and it is **not proven**
today.

Two acceptable implementations:

1. **Two backends (preferred target):** server codegen emits HTML/DSD; client
   codegen emits mount/update/claim/dispose. No shared executable artifact.
2. **One recipe compiled per target:** the same authored recipe lowers
   separately for each host, with a compile-time-selected emission.

What is **not** acceptable: shipping a generic interpreter plus a host vtable so
that one program runs everywhere. If a host interface is used at all, it is an
internal detail of one backend and must not become a runtime dispatch surface.

The concrete illustration below is therefore one possible shape, not a mandate:

| Mode | Host |
| --- | --- |
| SSR | string/serializer backend (the server lane already emits direct string composition, `server-component.ts:1-33`) |
| Fresh mount | DOM backend |
| Claim | DOM backend in claim mode, walking existing markers instead of creating |

This is a **target, not an achievement**: claim-mode recipe insertion needs a
marker protocol that does not exist yet, and the string host must prove it can
reproduce the same instance order. Both are Alpha16 slice obligations, and
neither may be claimed until the same stateful list passes all three modes.

Repeated insertion under SSR produces repeated HTML — expected and correct. The
client must reproduce the same insertion order to claim; a mismatch is a bounded
recovery case, not a full-page rebuild.

## 5. Model comparison

| Model | Public VNode | Runtime dispatch | Independent instances | Lexical capture | SSR | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| **Mount recipe closure (recommended)** | no | no | yes | native closures | host parameterized | one closure per value site; one owner per insertion |
| Lazy descriptor object | effectively yes | yes (tag switch) | yes | must encode refs | needs serialization rules | object + dispatch |
| Eager instance at creation | no | no | no (one region) | n/a | awkward | allocates unused values |
| `cloneNode` duplication | no | no | no (no signals) | n/a | impossible | cheapest, semantically wrong |
| Closure template + clone (Solid-style) | no | no | yes for intrinsics | yes | needs separate string path | one template per instance |

The template-clone row is not rejected as an optimization: an intrinsic-only
subtree may be cloned from a `<template>` (never from mounted DOM) once
profiling justifies it. It cannot be the contract, because it cannot express
components, children, or props replacement.

## 6. Generated-code sketch for the stateful list

Illustrative only; the point is that instance boundaries are explicit.

```js
// authored: <li key={item.id}>{item.name}<input value={draft.value}/></li>
function Row__mount(scope, props) {
  const draft = signal(props.get('item').name);   // private state, once
  const li = document.createElement('li');
  scope.addRangeCleanup(() => li.remove());
  bindText(scope, li, () => props.get('item').name);
  const input = document.createElement('input');
  bindProperty(scope, input, 'value', () => draft.value);
  listen(scope, input, 'input', (e) => { draft.value = e.currentTarget.value; });
  li.append(input);
  return [li];
}
```

On keyed reuse the list block replaces what `props.get('item')` returns; the
`li` node, the `draft` signal, the input's current value and the listener are
all preserved, and the text binding re-runs. That is TSX-04's contract
expressed as code, and it is why the DOM identity assertions matter more than
text assertions.

## 7. Costs and risks

| Cost | Expected magnitude | Measurement obligation |
| --- | --- | --- |
| One closure per value-position JSX site | small, per evaluation | generated-bytes attribution (ADR-0174) |
| One `LifetimeScope` per instance and per insertion site | one object each | instance-count test on the stateful list |
| Props getter record per instance | one object per instance | compare coarse vs per-property |
| Claim marker protocol extension | bytes on the wire | wire-size gate before Alpha17 |

Risks:

- **Recipe identity is invisible.** Two insertions are indistinguishable in
  source; only the runtime distinguishes them. Tests must assert two distinct
  `LifetimeScope`s, not just two DOM nodes.
- **Deferred insertion after disposal.** A recipe captured and used after its
  defining owner disposed must fail closed with a coded diagnostic; captured
  signals would otherwise write to dead scopes.
- **Side effects in props expressions move.** Evaluation is per read, and
  therefore per insertion; this is a behaviour authors will hit. It must be
  documented and tested, not patched with a cache (§4.2a).
- **Claim order.** Repeated insertion means claim must reproduce a sequence, not
  a set; the marker protocol must encode order.
- **Cross-module recipes** (`import { Row } from 'lib'` then `<Row/>` in another
  package) require the precompiled ABI and remain OPEN for Alpha17.

## 8. What this document does not decide

OPEN, and must be resolved by evidence rather than by preference:

1. Final helper names, module path, and whether recipes are functions or a
   sealed internal object with a single call method.
2. Props tracking granularity (instance version vs per-property signal). This is
   an invalidation-channel choice only; getter evaluation is decided as per-read
   (§4.2a), so no variant may cache values.
3. Whether intrinsic-only subtrees use template cloning as an optimization.
4. The claim marker protocol for ordered repeated insertion.
5. Cross-module recipe distribution format.
6. Dynamic component types (`const C = cond ? A : B; <C />`) — rejected for
   Alpha16, needs an explicit `Dynamic` primitive with its own ownership rules.
7. Server-side recipe execution host for **bounded deferred regions** only
   (Alpha18). Ordinary async server components, including full-await output, are
   **M14 / Alpha16b** and are specified in
   [compiler-native-architecture §4.6a](./compiler-native-architecture.md#46a-async-server-components-alpha16-scope);
   they are not an Alpha18 host question. **SUPERSEDED HISTORY:** an earlier
   revision of this list said "for async (Alpha18)", conflating the two
   capabilities.
8. HMR state preservation when a recipe's defining module is replaced.

## 9. Test obligations before this model may be called implemented

Additional obligations introduced by §4.1a–§4.2a and §4.1d, beyond the ten
listed further below:

11. **Detach vs dispose**: ordinary `dispose()` leaves owned DOM in place;
    `dispose(true)` removes it. A test asserts both, because the difference is
    what makes reconnect work.
12. **Setup failure rollback** for each row of the §4.1b matrix: assert no
    surviving nodes, no surviving listeners, no surviving subscriptions, the
    original error surfaced, and every cleanup attempted.
13. **Owner lineage**: projection from a live descendant succeeds; projection
    from a non-descendant fails closed; insertion after the definition owner is
    disposed fails closed. Assert the failure is coded and source-located.
14. **Evaluation counts** (TSX-28): number of times a props expression runs for
    creation, insertion, update, keyed replacement, and claim. Under the per-read
    decision, three bindings reading one getter in one update produce three
    evaluations, not one cached value.
15. **Claim parity of counts, phase-labelled**: record the SSR, fresh-mount and
    claim counts separately. SSR-only reads are listed and excluded from the
    mount comparison; claim matches fresh mount for the same post-claim phase —
    the three phases are not forced to one equal number.
16. **Reconnect revival** (§4.1d): setup count stays 1; the fixture's expected
    logical subscription graph is reproduced with no duplicates and no loss
    (dynamic branches may hold zero or several, so "1" is not a universal count);
    private state survives; retained DOM/input is not additionally destroyed;
    platform focus differences are recorded, not asserted. Physical scope
    identity is not an acceptance criterion — revive creates a fresh
    `LifetimeScope` today, and resource-scope identity is OPEN.
17. **Dual-backend parity** (§4.7): for the same authored input, compare
    phase-labelled observable results across SSR, fresh mount and claim — counts,
    DOM and attributes, seed versus post-claim state, claim marker/key/order,
    bounded recovery, and error propagation. M06 and M08 own the compared
    results, M07 is the leaf-claim prerequisite, and M13 owns browser/server
    qualification. Sharing the IR is not evidence.

Minimum, on the stateful list slice (Slice 2), each asserting instance counts
and owner identity — not only rendered text:

1. Same recipe inserted twice: two owners, two private signals, two cleanups.
2. Two instances share one external signal: one write updates both, and
   disposing one leaves the other subscribed.
3. Repeated children projection: two independent subtrees; deleting one
   projection leaves the other live.
4. Deferred insertion: create, wait, insert — insertion still works and uses
   current prop values.
5. Recipe used after its defining owner disposed: coded failure, no DOM write.
6. Keyed reuse: DOM identity, input value, focus, selection, handler sees the
   new item, `draft` preserved.
7. Key change: new instance, no state carry-over; duplicate key: coded failure.
8. Projection across owner subtrees: coded rejection.
9. SSR/mount/claim behavioural parity for the same list, including repeated
   insertions; counts are compared per phase, with SSR-only reads recorded
   separately rather than forced equal to client counts.
10. Dispose with a throwing cleanup: remaining cleanups still run, first error
    surfaces once.

Each item lists the phase matrix in
[the semantic test matrix](./alpha16-18-semantic-test-matrix.md). A pass at
compile time, or a generated-source snapshot match, does not satisfy any of
them.
