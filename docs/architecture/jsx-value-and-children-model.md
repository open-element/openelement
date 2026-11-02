# JSX values and repeatable children: execution model

Date: 2026-11-03. Status: **CANDIDATE DESIGN / NOT IMPLEMENTED**. Baseline:
`4f1f2001b24909086f7e7efe9e5016d48d615c91`.

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

`insert` is the only new runtime primitive this model requires:

```js
function insert(owner, recipe, parent, before) {
  const scope = owner.child();          // the projection-site owner
  const nodes = recipe(scope, parent, before);
  scope.addRangeCleanup(() => removeNodes(nodes));
  return nodes;
}
```

Both pieces already exist: `LifetimeScope.child()` and `addRangeCleanup`
(`lifetime-scope.ts:28-30`, `:63-69`).

### 4.1 Why this is not a VDOM

- The recipe closes over a **statically known** mount function
  (`Counter__mount`), fixed at compile time. There is no runtime resolution of
  a component from a value.
- There is no tree to diff. Insertion is an imperative create at a known site.
- The recipe has no inspectable shape, so no generic walker can traverse it.
  Any consumer must call it, which requires an owner — i.e. the semantics are
  enforced by the type of the primitive, not by convention.

### 4.2 Evaluation timing

This is the semantic decision authors will notice, so it must be explicit:

| Moment | What happens |
| --- | --- |
| Recipe creation (the JSX expression evaluated as a value) | closure allocated; lexical bindings captured; **no** DOM, **no** instance, **no** signal read, **no** user expression executed |
| Insertion | child owner created; optional key thunk read; component setup runs **once** for this instance; props getters close over the defining scope |
| Update | effects whose tracked reads changed re-run; setup does not re-run; instance identity preserved |
| Disposal | the projection-site owner disposes: children, then own cleanups LIFO; one throwing cleanup does not stop the rest |

Consequence to accept explicitly: a props expression such as
`<Counter step={next()}/>` is evaluated **per insertion**, not once at
creation. Two insertions of one recipe may therefore receive different prop
values if the captured state changed between them. This differs from React,
where the element object snapshots props once. It is the price of independent
instances and it must be tested, not discovered.

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

The same generated code must serve all three, so the recipe targets a host
interface rather than `document` directly:

| Mode | Host |
| --- | --- |
| SSR | string/serializer host (the server lane already emits direct string composition, `server-component.ts:1-33`) |
| Fresh mount | DOM host |
| Claim | DOM host in claim mode, walking existing markers instead of creating |

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
- **Side effects in props expressions move.** Per-insertion evaluation is a
  behaviour authors will hit; it must be documented and tested, not patched.
- **Claim order.** Repeated insertion means claim must reproduce a sequence, not
  a set; the marker protocol must encode order.
- **Cross-module recipes** (`import { Row } from 'lib'` then `<Row/>` in another
  package) require the precompiled ABI and remain OPEN for Alpha17.

## 8. What this document does not decide

OPEN, and must be resolved by evidence rather than by preference:

1. Final helper names, module path, and whether recipes are functions or a
   sealed internal object with a single call method.
2. Props tracking granularity (instance version vs per-property signal).
3. Whether intrinsic-only subtrees use template cloning as an optimization.
4. The claim marker protocol for ordered repeated insertion.
5. Cross-module recipe distribution format.
6. Dynamic component types (`const C = cond ? A : B; <C />`) — rejected for
   Alpha16, needs an explicit `Dynamic` primitive with its own ownership rules.
7. Server-side recipe execution host for async (Alpha18).
8. HMR state preservation when a recipe's defining module is replaced.

## 9. Test obligations before this model may be called implemented

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
9. SSR/mount/claim parity for the same list, including repeated insertions.
10. Dispose with a throwing cleanup: remaining cleanups still run, first error
    surfaces once.

Each item lists the phase matrix in
[the semantic test matrix](./alpha16-18-semantic-test-matrix.md). A pass at
compile time, or a generated-source snapshot match, does not satisfy any of
them.
