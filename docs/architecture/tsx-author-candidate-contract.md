# TSX author candidate contract

Date: 2026-11-03. Status: **CANDIDATE / NOT IMPLEMENTED OR VERIFIED**.
Baseline: `4f1f2001b24909086f7e7efe9e5016d48d615c91`.

Revised 2026-11-05: props getters are **decided per-read** (TSX-28), which is
also a correction to TSX-03 and TSX-09; reconnect resource persistence (TSX-14)
and dual-backend parity (TSX-18) are recorded as OPEN obligations with named
milestones.

This contract is the author-facing half of
[ADR-0173](../adr/ADR-0173-component-execution-and-composition.md) and
[ADR-0174](../adr/ADR-0174-generated-code-runtime-and-compatibility.md). Its
execution model — including reusable JSX values and repeatable children
projection — is specified in
[JSX values and repeatable children](./jsx-value-and-children-model.md). It is
not an alpha.15 tutorial, not a runnable suite, and not a frozen public API.

## Reading the samples

Every snippet is candidate TSX that cannot be imported today. Names such as
`component`, `signal`, `computed`, `Children`, `onConnect`, `onDispose`, `ref`,
`context`, `provide`, `useContext`, `nativeElement` and `ErrorBoundary` are
review notation with **unreleased, unselected signatures**. Standard JSX syntax
is the input target; React semantics are not. `Item`, `loadItems` and similar
names stand for application inputs.

Rules that hold for every case below:

1. Setup runs once per logical instance per environment. SSR and client
   initialize separately; the server runs no connection callback.
2. Ordinary locals, destructuring and ordinary function calls keep JavaScript
   semantics. Only explicit `computed` and computations written directly in a
   JSX dynamic expression are reactive.
3. A JSX expression in value position is a **mount recipe** — a lazy insertion
   description. Creating it allocates no DOM and no instance; each insertion
   creates its own owner, instance and DOM region.
4. Cleanup belongs to the projection site; lexical dependencies belong to the
   definition site.
5. `props` is a read-only record whose property reads are tracked and evaluated
   on **every read** (no per-tick cache); `children` is a recipe, not a DOM
   fragment.
6. A value not statically known is checked by a runtime guard carrying a source
   location. The guard is not a renderer fallback.

Phase vocabulary: **SSR**, **Mount** (fresh client DOM), **Claim** (existing SSR
DOM), **Update**, **Dispose**. An `n/a` in the matrix is valid only with a stated
reason. Record setup/cleanup counts, source locations and resource counts with
test probes, not a new public debugging API. Generated-source snapshots alone are
insufficient. All implementation tests in this document are **NOT RUN**.

## 1. Approved revisions

These five cases carry the owner-approved semantics from 2026-11-03 and are the
first thing to re-review; the remaining cases must not contradict them.

### TSX-03 — props reads versus destructuring

```tsx
const Label = component((props: { readonly value: number }) => {
  const { value: snapshot } = props;
  return <p>{props.value}/{snapshot}</p>;
});
```

Parent moves `value` 1 → 2: `props.value` renders `2`, `snapshot` stays `1`,
setup does not re-run, the instance is preserved.

Required mechanics: props are read-only input; a property read performed inside
a tracked context is tracked; destructuring reads once during setup and is
therefore a snapshot; nested objects are not deep-proxied; ordinary locals are
never silently converted into signals; the author never wires a subscription by
hand.

OPEN: whether the props record is one versioned source or per-property signals
(model note §4.3). Both satisfy the author-visible contract **only while every
read re-evaluates the getter** — evaluation is per-read (model note §4.2a,
APPROVED). The choice is an invalidation-channel and cost decision; a variant
that returns a cached value per version changes observable counts and is not an
equivalent option.

### TSX-04 — keyed identity with props replacement

```tsx
const Row = component((props: { readonly item: Item; readonly save: (i: Item) => void }) => {
  const draft = signal(props.item.name);
  return (
    <>
      <span>{props.item.name}</span>
      <input value={draft.value}
        onInput={e => { draft.value = e.currentTarget.value; }} />
      <button onClick={() => props.save(props.item)}>Save</button>
    </>
  );
});
```

Accept: **preserve identity, update props.** Same key and same component type ⇒
instance kept, `draft` kept, props updated, rendering updated, handler reads the
new item, DOM identity preserved as far as the platform allows. No setup
re-execution, no signal re-initialization, no stale capture. Deleting the row
disposes it fully; key or type change creates a new instance; reorder must not
lose state.

Implementation requirement that is easy to skip: the value behind `props.item`
must be replaceable **while existing effects and handlers keep reading the
current one** — the invariant the runtime already enforces for list entries
through `itemBox`
(`packages/element/src/internal/compiled/runtime/blocks.ts:204-224`).

### TSX-05 — ordinary computation, computed, inline JSX expression

```tsx
const snapshot = props.items.filter(i => i.name.includes(query.value));   // once, at setup
const live = computed(() => props.items.filter(i => i.name.includes(query.value)));
```

```tsx
return <p>{props.items.filter(i => i.name.includes(query.value)).length}</p>;  // tracked
```

| Position | Semantics |
| --- | --- |
| ordinary setup local | snapshot, evaluated once |
| explicit `computed` | reactive derivation |
| JSX dynamic expression | compiler-established fine-grained tracking |
| ordinary event handler | ordinary JavaScript at dispatch time |

The inline form decides whether the model feels natural, so it is not optional:
the compiler must wrap that expression — and only that expression — in a tracked
evaluation that updates the single dependent DOM location. Wrapping the whole
component body in one effect is prohibited.

### TSX-09 — reusable JSX values

```tsx
const counter = <Counter />;
return <>{counter}{counter}</>;
```

Accepted: a JSX value in value position is a **lazy, reusable insertion
description**. Two insertions produce two instances with independent owners,
private signals, DOM regions and cleanups. The value may also be stored, returned
from an ordinary function, placed in an array, or inserted later.

Not accepted: sharing one mounted region; moving one instance to two positions to
simulate duplication; `cloneNode` of mounted DOM; a public VNode type; a runtime
type table that resolves a component from a value.

The execution model, generated-code shape, evaluation timing and failure modes
are in [the model note](./jsx-value-and-children-model.md). The author-visible
consequence that must be tested rather than discovered: props expressions are
evaluated **per read**, not once when the value is created — so an insertion
sees current values, and two insertions can observe different ones.

### TSX-10 — repeatable children projection

```tsx
function Frame(props: { children: Children }) {
  return <><section>{props.children}</section><aside>{props.children}</aside></>;
}
```

Accepted: **children may be projected more than once; each projection is an
independent owner and region.** Deleting one projection leaves the other live.
Two boundary rules:

- Lexical dependencies come from the definition site; cleanup ownership comes
  from the projection site.
- Projection must stay inside the defining owner's subtree in Alpha16. A
  cross-owner projection (teleport/portal) is a coded rejection, not a silent
  orphan.

Ordinary functions remain ordinary: `props.render('A')` runs only where the
author calls it, and its result is inserted at that site. Passing a function as a
prop never converts it into a recipe.

## 2. Case catalogue

A case is satisfied only when its matrix row is green for the phases listed and
its negative cases fail closed.

### TSX-01 — roots, fragments and empty output

```tsx
const Pair = component(() => <><h1>Hello</h1><p>World</p></>);
const Empty = component(() => <></>);
```

Multiple roots and empty output are admitted; an empty instance still has a
disposable owner; SSR and Mount render equivalent content; Claim keeps matching
nodes. Phases: SSR, Mount, Claim, Dispose; Update `n/a` because static bindings
have nothing to update. Negative: a root that is neither element nor fragment is
a compile diagnostic, not a runtime fallback.

### TSX-02 — signal and computed

```tsx
const count = signal(0);
const doubled = computed(() => count.value * 2);
return <button onClick={() => count.value++}>{count.value}:{doubled.value}</button>;
```

Initial `0:0`; a click produces `1:2` without repeating setup; only dependents
update; writing a retained signal after Dispose writes no DOM and keeps no
subscription. Phases: SSR, Mount, Claim, Update, Dispose. OPEN: computed caching
and flush timing.

### TSX-03 — props reads versus destructuring

See §1. Phases: SSR, Mount, Claim, Update. Negatives: writing to `props` is a
compile error or a coded failure; mutating a nested object is documented as
outside the reactive contract (the same object-identity boundary the keyed list
already draws).

### TSX-04 — keyed identity with props replacement

See §1. Phases: Mount, Claim, Update, Dispose (SSR `n/a`: identity is a client
property). Required assertions: DOM node identity, input value, focus, selection,
handler sees the new item, `draft` preserved, cleanup released on delete.
Negatives: duplicate key fails closed; key change creates a new instance with no
state carry-over.

### TSX-05 — ordinary computation, computed, inline expression

See §1. Phases: Mount, Update (SSR for the initial snapshot). Negatives: an
inline expression that throws reports at the authored location without
corrupting unrelated bindings; a side effect inside an inline expression runs per
dependent update — documented, and the reason side effects belong in handlers.

### TSX-06 — conditions and numeric zero

```tsx
return <>{props.n > 0 && <span>{props.n}</span>}{props.n === 0 ? <em>zero</em> : null}</>;
```

A false condition creates no instance and no subscription; exiting disposes the
subtree; re-entry creates a new instance with initial state; `0` renders as text
while `false` renders nothing. Phases: SSR, Mount, Claim, Update, Dispose.
Negative: truthiness of non-boolean values follows the documented table, not
React's.

### TSX-07 — keyed movement

Moving an entry preserves instance, private state, DOM node, selection and focus
where the platform allows; the handler reads the new item. Phases: Mount, Claim,
Update, Dispose (SSR `n/a`). Negatives: reorder must not recreate entries; a
duplicate key is a coded failure.

### TSX-08 — unkeyed positions

The positional rule is stated once and tested: an unkeyed list matches by
position, so reordering may reassign instances. Authors who need identity must
key. Phases: Mount, Claim, Update, Dispose. Negative: no silent fallback from
unkeyed to keyed semantics.

### TSX-09 — reusable JSX values

See §1 and the model note. Phases: SSR, Mount, Claim, Update, Dispose. Required
extra cases: two insertions (TSX-23), deferred insertion (TSX-25), post-disposal
use (negative), cross-module value (OPEN, Alpha17).

### TSX-10 — repeatable children projection

See §1. Phases: SSR, Mount, Claim, Update, Dispose. Required: two insertions
independent; deleting one leaves the other; cross-owner projection rejected
(TSX-26).

### TSX-11 — spread order and removal

Explicit attributes after a spread override it; a spread property removed from
the source removes the attribute; getters evaluate in source order; attribute and
property channels stay distinct; URL-sensitive sinks keep the existing screen.
Phases: Mount, Update. Negatives: prototype-polluting keys rejected; event
attributes through a spread obey the same rules as explicit ones.

### TSX-12 — events, callbacks and refs

DOM handlers receive native events; callbacks are not invoked at pass-through
time; replacing a handler does not duplicate listeners; refs are assigned when
the node is ready and released on removal. Phases: Mount, Claim, Update, Dispose
(SSR `n/a`: refs are client-only). Negatives: ref timing is not promised to match
React; a throwing handler is contained by the boundary rather than corrupting the
region; reading DOM during setup is not treated as connected.

### TSX-13 — context isolation

Lookup follows the nearest owning component, including hostless owners; two
sibling subtrees do not share values; concurrent SSR requests do not share
values. Phases: SSR, Mount, Update, Dispose. OPEN: default representation,
provider lifetime, whether context values are reactive.

### TSX-14 — CE connection lifecycle

`onConnect` runs when DOM/refs are ready and connected, may return a cleanup, does
not run during SSR, and may run again after reconnect without repeating setup;
CSS-hidden instances stay subscribed; disconnect releases connection resources.
Phases: Mount, Claim, Update, Dispose (SSR `n/a`). Negatives: a platform move may
still fire platform callbacks; no zero-callback promise.

Reconnect does not re-run setup. CURRENT FACT: the suspend path disposes the
resource owner (plain `dispose()`) while retaining the DOM, and revive constructs
a **fresh** root `LifetimeScope` and re-arms the retained bindings
(`runtime/revive.ts:326`). The target therefore has to preserve the **logical**
instance, its setup count and its private state; a surviving physical scope
object does not follow, and is not an acceptance criterion. That resource-level
contract is **OPEN**, owned by **M05–M09** and specified in
[model note §4.1d](./jsx-value-and-children-model.md): M07–M08 exercise the
retained-DOM/disposed-owner difference, and M09 is the generated Native CE
boundary where platform reconnect occurs.

Acceptance evidence is setup count 1, the fixture's expected logical
subscription graph reproduced with no duplicate and no loss (a dynamic branch
may hold zero or several; no universal count of 1), private state preserved, and
no additional destruction of preservable DOM/input. Focus after a platform
detach/reinsert is recorded as a platform difference, not promised; no focus
restoration API is added. Claim fidelity is TSX-18's separate in-place contract.
The callback names may be settled later (Alpha17, §5); the persistence semantics
may not wait with the names.

### TSX-15 — runtime renderability

```tsx
return <div>{props.value}</div>;
```

Strings and numbers render as text; `null`/`undefined`/booleans render nothing;
arrays flatten under the ownership rules; objects, symbols, bigints, bare
functions and Promises fail with a coded diagnostic carrying the authored
location. Static invalid values may fail at compile time; runtime-unknown values
use the guard. Phases: SSR, Mount, Update. Negatives: no implicit `String()`
coercion and no implicit invocation.

### TSX-16 — iterables

Arrays are the initial supported collection; other iterables are OPEN and
rejected until one-shot and infinite cases are qualified. Phases: SSR, Mount,
Update. Negative: unbounded consumption is prohibited on server and client.

### TSX-17 — server async boundary

A server component may await data before producing output; the emitted HTML and
any interactive descendants are tested separately; server-only code reaching the
client graph is a coded build failure. Phases: SSR only (no browser instance).
Negatives: a Promise is not a normal child; bounded defer is Alpha18. Ordinary
async server components, including full-await output, are **M14 / Alpha16b**;
they are not an Alpha18 defer feature and the two must not be conflated.

### TSX-18 — SSR seed and Claim fidelity

SSR and client setup each run once with matching serialized state; successful
Claim preserves DOM, pre-activation user input, focus and selection; mismatch
recovers within bounds with source locations. Phases: SSR, Claim, Update,
Dispose. Negatives: a failed claim must not double-subscribe; a rebuild must
dispose old resources first. Those sentences do not require the current claim
runtime to restore every DOM byte on failure. Successful Claim still preserves
pre-activation user input, focus and selection. A failed claim, under the
current recipe contract, releases resources with `dispose(false)` and does not
delete borrowed DOM: a validation failure writes nothing, and an activation
failure may leave an earlier dynamic write. Restoring the whole region
byte-for-byte would be a separate design.

Same IR is not automatic parity: server and client may be generated from one
semantic IR, but equivalence is asserted behaviourally **per phase** for the same
authored input — evaluation counts against the §4.2a row for that phase
(SSR-only reads may legitimately differ and are recorded, not forced equal), DOM
and attributes, SSR seed state versus post-claim state, claim marker/key/order,
bounded recovery, and error propagation (diagnostic identity and authored
location). M06 (fresh mount) and M08 (SSR→claim) produce the compared results; M07
is the leaf-claim prerequisite; M13 qualifies browser and server. That is the
acceptance chain in [the execution plan](./alpha16-18-execution-plan.md); see
model note §4.7. It is not a proven consequence of sharing the IR.

### TSX-19 — error and cleanup containment

A boundary captures descendant failures; one throwing cleanup does not suppress
the rest; dispose is idempotent. Setup failure must be exception-safe per the
model note §4.1b: the child scope exists before the first node, every resource
registers as acquired, and a failed setup disposes that scope in detach mode so
no partial DOM region survives, every cleanup is attempted, and the original
construction error is what surfaces.

Required failure rows (each needs its own test, not one combined case): failure
before the first node; after partial DOM; after signal subscriptions; after
event listeners; during insertion into the parent; during nested component
setup; and a cleanup that throws while others remain.

Phases: SSR (server errors), Mount, Claim, Update, Dispose. OPEN: boundary reset
policy.

### TSX-20 — explicit CE and third-party WC

The native export behaves from ordinary HTML and foreign frameworks with
properties, events, slots, forms and shadow behaviour; third-party WC use is
client-only through a tested boundary; manifest declarations do not prove SSR
capability. Phases: Mount, Claim (native export), Update, Dispose (SSR `n/a` for
foreign internals). Negatives: foreign tags are not auto-registered and not
assumed SSR-capable.

### TSX-21 — independent precompiled package

A tarball supplies chosen server/client entries, declarations and relocatable
CSS; a fresh application consumes it with no library TSX and no workspace alias;
ABI mismatch, duplicate runtimes, missing types/CSS and server chunks in client
graphs fail closed. Phases: all, in the consumer project. OPEN: metadata format
and version ranges; this evidence starts before ABI freeze.

Scope boundary (Alpha16 vs Alpha17), stated rather than implied:

- **Alpha16 proves** that the generated artifact and the supported consumption
  surface work from a fresh packed application — the stateful list is packaged
  as one compiled artifact and consumed without aliases or library TSX.
- **Alpha16 does not require** arbitrary cross-module function-component recipe
  composition; that ABI is deferred to Alpha17.
- **Alpha17 qualifies** cross-module component recipes and the frozen precompiled
  ABI.
- TSX-21 therefore does **not** prove cross-module recipe distribution in
  Alpha16. A green TSX-21 row must say which of the two it exercised.

### TSX-22 — HMR and source locations

Errors map to authored TSX, not helper offsets; a replaced module disposes its
subscriptions without duplicates. Phases: SSR (initial output and mapped
errors), Mount, Update (dev only). OPEN: state preservation policy.

### TSX-23 — one recipe inserted twice

```tsx
const c = <Counter />;
return <>{c}{c}</>;
```

Two distinct owners, two private signal sets, two DOM regions, two cleanups;
updating one instance does not update the other. Phases: SSR, Mount, Claim,
Update, Dispose. Negatives: shared region, moved instance, `cloneNode`
duplication.

### TSX-24 — instances sharing one external signal

```tsx
const total = signal(0);
const A = <Reader value={total.value} />;
return <>{A}{A}</>;
```

One write updates both instances; disposing one leaves the other subscribed; no
duplicate subscription accumulates on Claim. Phases: SSR, Mount, Claim, Update,
Dispose.

### TSX-25 — deferred insertion

```tsx
const late = <Counter />;
onConnect(() => { setTimeout(() => host.append(...insertInto(owner, late)), 10); });
```

Creating a recipe allocates no DOM and no instance; inserting later uses the
current prop values; insertion into a disposed definition owner fails closed
with a coded, source-located diagnostic. The insertion API shown is illustrative
and unreleased, and the lineage check it depends on is OPEN (model note §4.1c).
Phases: Mount, Update, Dispose (SSR `n/a`).

### TSX-26 — independent projection deletion and cross-owner rejection

With two projections of the same children, removing one leaves the other's
instance, signals and DOM live and does not dispose shared state. Removal of one
projection uses **detach mode** on that projection's owner only; the sibling's
DOM must survive. A projection into a different owner subtree fails closed with a
coded diagnostic, which requires the lineage mechanism described in the model
note §4.1c (OPEN). Phases: Mount, Update, Dispose.

### TSX-27 — parent owner disposal

Disposing the parent disposes all descendant owners exactly once, including every
projection and every list entry, and the mode cascades (children inherit
detach or non-detach from the parent call, `lifetime-scope.ts:100`); a second
dispose is a no-op; a throwing cleanup does not prevent the remaining ones.
Distinguish the two modes explicitly: plain `dispose()` keeps owned DOM (the
disconnect/suspend path), `dispose(true)` removes it. A later `dispose(true)`
on the same scope does not upgrade a plain dispose: the second call returns
without running the range cleanups that the first call already dropped.
Parent `dispose(true)` cascades only to children still live. A descendant
already disposed with the plain flag is not re-entered, and its DOM stays.
Phases: Mount, Claim, Dispose.

### TSX-28 — expression evaluation counts

The full observable contract is the model note §4.2a table (nine situations);
row 3 there is counted **per read**, not per binding or per update.

**APPROVED (owner ruling; semantics, not implementation or measurement): props getters evaluate per read.** In one line: a
props expression does **not** run at recipe creation; it runs on **every getter
read**, so a dependent re-evaluation performs one evaluation per read it
performs; destructuring reads once during setup; inline JSX expressions run per
dependent update; handlers run per dispatch; setup runs once.

A test asserts the counts, because this is where authors will otherwise guess
wrong. The equality obligation is **fresh mount vs claim for the same client
phase**; SSR reads are recorded separately and are not required to equal client
counts. The locked case is three bindings reading one getter in one update: three
evaluations, never one cached value. TSX-28 verifies and records cost; it does
not choose the semantics. Any memoisation that changes evaluation count, return
value or side-effect order is a semantic change and needs a new owner ruling.

**SUPERSEDED HISTORY:** an earlier revision of this case recorded "getter is
memoised per tick or evaluated per binding — decided by this case". That framing
is withdrawn; the per-read decision and its observable consequences are recorded
in model note §4.2a.

Phases: SSR, Mount, Claim, Update.

### TSX-29 — dynamic component type

```tsx
const C = cond ? A : B;
return <C />;
```

Status: **rejected for Alpha16.** A future distinction may be drawn between a
compile-time-known finite set of component branches and arbitrary runtime
component resolution, but that is not a capability added here. Resolving a component from a runtime value
requires runtime dispatch, which the model forbids. A later explicit `Dynamic`
primitive would need its own identity and ownership rules. The rejection is a
source-located diagnostic, not a crash. Phases: `n/a` (rejected at compile time).

### TSX-30 — repeated instances across SSR and Claim

Two insertions of one recipe render two regions on the server; Claim reproduces
the same insertion order and does not merge, duplicate or reorder the instances;
a mismatch is bounded recovery with a diagnostic. Phases: SSR, Claim, Dispose.

## 3. Applicability matrix

| Case | SSR | Mount | Claim | Update | Dispose | Note when n/a |
| --- | --- | --- | --- | --- | --- | --- |
| TSX-01 | ✔ | ✔ | ✔ | n/a | ✔ | static content has nothing to update |
| TSX-02 | ✔ | ✔ | ✔ | ✔ | ✔ | computed caching OPEN |
| TSX-03 | ✔ | ✔ | ✔ | ✔ | n/a | dispose covered by TSX-27 |
| TSX-04 | n/a | ✔ | ✔ | ✔ | ✔ | identity is a client property |
| TSX-05 | ✔ | ✔ | ✔ | ✔ | n/a | evaluation-count test |
| TSX-06 | ✔ | ✔ | ✔ | ✔ | ✔ | |
| TSX-07 | n/a | ✔ | ✔ | ✔ | ✔ | movement is client-side |
| TSX-08 | ✔ | ✔ | ✔ | ✔ | ✔ | positional rule |
| TSX-09 | ✔ | ✔ | ✔ | ✔ | ✔ | see model note |
| TSX-10 | ✔ | ✔ | ✔ | ✔ | ✔ | see model note |
| TSX-11 | ✔ | ✔ | ✔ | ✔ | n/a | |
| TSX-12 | n/a | ✔ | ✔ | ✔ | ✔ | refs are client-only |
| TSX-13 | ✔ | ✔ | ✔ | ✔ | ✔ | provider lifetime OPEN |
| TSX-14 | n/a | ✔ | ✔ | ✔ | ✔ | no SSR connection |
| TSX-15 | ✔ | ✔ | ✔ | ✔ | n/a | guard has a location |
| TSX-16 | ✔ | ✔ | ✔ | ✔ | n/a | arrays only |
| TSX-17 | ✔ | n/a | n/a | n/a | n/a | server-only component |
| TSX-18 | ✔ | n/a | ✔ | ✔ | ✔ | |
| TSX-19 | ✔ | ✔ | ✔ | ✔ | ✔ | reset policy OPEN |
| TSX-20 | n/a | ✔ | ✔ | ✔ | ✔ | foreign internals not claimed |
| TSX-21 | ✔ | ✔ | ✔ | ✔ | ✔ | in the consumer project |
| TSX-22 | ✔ | ✔ | n/a | ✔ | n/a | dev-only replacement |
| TSX-23 | ✔ | ✔ | ✔ | ✔ | ✔ | |
| TSX-24 | ✔ | ✔ | ✔ | ✔ | ✔ | |
| TSX-25 | n/a | ✔ | n/a | ✔ | ✔ | deferred insertion is client-side |
| TSX-26 | n/a | ✔ | n/a | ✔ | ✔ | |
| TSX-27 | n/a | ✔ | ✔ | n/a | ✔ | |
| TSX-28 | ✔ | ✔ | ✔ | ✔ | n/a | counts are the assertion |
| TSX-29 | n/a | n/a | n/a | n/a | n/a | rejected with a diagnostic |
| TSX-30 | ✔ | n/a | ✔ | n/a | ✔ | ordered insertion |

An `n/a` without the stated reason is a contract defect.

## 4. Cross-cutting negatives

These must fail closed with a source location in every phase where they apply:

1. JSX executed outside the compiler pipeline (the existing `jsx-runtime.ts`
   guard).
2. A component whose program is missing.
3. A JSX value used as a DOM node, string or property without insertion.
4. A recipe inserted into a disposed owner, or projected across owner subtrees.
5. Duplicate keys, and key/type replacement that would reuse state.
6. Non-renderable runtime values (the TSX-15 list).
7. Unbounded iterables and unbounded defer.
8. Server-only modules reachable from a client graph.
9. A dynamic component type (TSX-29).
10. Mixed build identity between server output and the client bundle.

## 5. OPEN items

Each needs a measurement or an evidenced decision, not more prose:

1. Props tracking granularity (version signal vs per-property) — the
   invalidation channel only; getter evaluation is per-read (TSX-28), so no
   variant may cache values.
2. Recorded count for an inline expression that reads one getter several times
   in a single evaluation — per-read semantics is decided; only the recording
   form is open.
3. Claim marker protocol for ordered repeated insertion.
4. Cross-module recipe distribution (Alpha17) and whether a recipe may cross a
   package boundary before the ABI exists.
5. Intrinsic-subtree template cloning as an optimization.
6. Context default representation and reactivity.
7. `onConnect` / `onDispose` final names and signatures — names only; reconnect
   resource persistence is not deferred with them (model note §4.1d).
8. HMR state preservation.
9. Iterable admission beyond arrays.
10. Whether an explicit insertion escape hatch is public at all.

## 6. Review and implementation sequence

1. Owner reads TSX-03/04/05/09/10 and states the expected behaviour per sample.
2. Disagreements change this contract, not the documentation of the
   implementation.
3. Alpha16 implements Slice 1 → Slice 2 → Slice 3 in order; each slice fills its
   matrix rows with real browser evidence.
4. Public API names are frozen only after G3 (author and consumer evidence).
5. No case may be marked implemented, typechecked, browser-qualified or released
   by the existence of this document.

See also: [the execution plan](./alpha16-18-execution-plan.md),
[the semantic test matrix](./alpha16-18-semantic-test-matrix.md),
[the audit](./alpha16-18-architecture-audit.md).
