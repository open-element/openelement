# ADR-0183: One reactive contract for the generated lane — one engine, one subscription wiring, one lifecycle scope, one derived-state contract

- Status: **ACCEPTED** (owner direction 2026-11-20, in-session; implementation pending)
- Date: 2026-11-20
- Owner direction: 2026-11-20 — "一个引擎、一个订阅接线、一个生命周期范围、一个衍生状态合同"; the same session directed that a P6/P8 defect of this class is fixed at the architecture level rather than patched, and that the props duplication recorded in §Context is a bug to be fixed with priority.
- Amends: nothing. It records a decision about mechanisms that already ship, and a defect the repository's own gates failed to catch.
- Related: ADR-0173, ADR-0174, ADR-0180, ADR-0181, ADR-0182, ADR-0163 (seams), [the design constitution](../architecture/design-principles.md), [the M04 runtime-primitive record](../architecture/alpha16-18-progress.md), [the M09-0 shell record](../architecture/m09-generated-element-shell.md)

## Context

### 1. The generated lane's reactive machinery is currently in pieces

Four artefacts exist, and they do not share one contract:

| # | Artefact | Owner today | What it does |
| --- | --- | --- | --- |
| 1 | Signal engine | `packages/element/src/internal/signal/preact-engine.ts` (`createPreactEngine`) | The only engine: `@preact/signals-core` behind the internal `SignalEngine` seam (`signal` / `computed` / `effect` / `batch` / `untracked`). |
| 2 | Subscription wiring | `packages/element/src/internal/compiled/runtime/bindings.ts` (`bindSignalWrites`, `guardUpdate`) + the compiler's emitted `bindSignalWrites(...)` calls | Per-slot refresh closures subscribed to **named** signals; props reads are wired through `host.propDeps`. |
| 3 | Lifecycle scope | `packages/element/src/internal/compiled/lifetime-scope.ts` + `runtime/instance-ledger.ts` | `instance` → `connection` → `projection`; subscriptions released with the owning scope. |
| 4 | Derived state | **two implementations, one dead** — see §2 | — |

### 2. The defect: two props mechanisms, and the correct one has no production caller

| Primitive | Introduced | Shape | Production callers |
| --- | --- | --- | --- |
| `createTrackedProps` (`packages/element/src/internal/compiled/runtime/props.ts:57`) | **2026-11-09**, commit `a82ef5957` (M04, PR #1735) | Per-read getters over **one version signal**; `replace(next)` swaps the backing record. A read inside an effect **tracks** that signal. | **zero** (only `runtime.ts` re-export + tests) |
| `createState`'s props record (`packages/element/src/internal/compiled/generated-element/shell.ts:1451-1470`) | **2026-11-13**, commit `735749b1c` (M09-0, PR #1768) | Per-read getters over a **plain `Map`** plus a separate `propsChanged` **counter** signal, bumped by `bumpProps` (`:1504-1506`) | every generated element (production) |

The shell's getters read `values.get(name)` — a `Map`, not a signal. Nothing a getter reads is trackable, which is why a component-authored `computed` closed over `props` would compute once and then serve a stale value forever. That is the entire technical content of the 2026-11-18 ruling "no `computed` support in the generated lane; inline instead" ([`16b-migration-note.md` §"2026-11-18 ruling"](../architecture/16b-migration-note.md)). **The 2026-11-18 ruling is a consequence of this duplication, not an independent design choice.**

The duplication is not a stylistic preference. Measured consequences:

- `props` is a **second source of truth** (P6) for "what are this instance's props", one of them unreachable by the reactive engine.
- The seam registry does not register this channel at all. `docs/architecture/seams.md` names the generated-element shell as "the ONE owner of the per-read props record and the shell-owned `propsChanged` signal" — a sentence that **legitimises the fork** by declaring one implementation the owner, while the M04 primitive goes unmentioned (P8).
- `createTrackedProps` is dead code that still ships in the public internal surface (`packages/element/src/internal/compiled/runtime.ts:160`, and the public-interface snapshot lists it).
- The capability inventory records "derived values — **DELIBERATELY ABSENT**" (`alpha16-capability-inventory.md`), which states the symptom as a principle.
- The `propDeps` channel (31 references across the compiler and the shell) exists **only** to compensate for getters that do not track. It would be unnecessary if props were signal-backed.

### 3. Why the gates did not catch it

Recorded here because the fix must include the gate, not only the code:

1. **The seam row was written from the implementation's point of view.** `seams:check` validates that a row has one owner, a direction, crossing artefacts, a guard test and the missing/unreadable clause — all true for the row above. Nothing in the repository can ask "is there a second implementation of this same concept?", because the registry is a list of rows, not a search over the mechanism space.
2. **No consumer-form test spanned the two implementations.** The M09-0 suite proves the shell's props record behaves (21 tests, cross-reconnect retention included). Nothing asserted that the shell's props record *is* the M04 primitive, so 21 correct tests on a forked implementation read as a green signal.
3. **"Do not import the runtime barrel" was read as "do not reuse runtime primitives."** The M09-0 commit narrative says the shell must not import `facade-host.ts`, `runtime-program.ts`, the kernel, the runtime barrel or the Part Program executor — a P1/bundle-size rule about the **executor**. But the shell in fact imports four sibling modules from the same directory (`../runtime/recipe.ts`, `../runtime/values.ts`, `../runtime/context.ts`, `../runtime/instance-ledger.ts`), so importing `../runtime/props.ts` was never forbidden by the rule. The forbidden thing was one barrel, and the boundary was generalised by habit.
4. **Slices land in different PRs, so nobody owns the sum.** M04 (runtime primitives) and M09-0 (element shell) are four days and one milestone apart; each PR was reviewed against its own goal, and no artefact in the repository asks "which existing primitive does this replace".

## Decision

**D-1. One engine.** `@preact/signals-core` behind `SignalEngine` is the only reactive engine in the framework. No second engine, no framework-private tracker, no DOM-diffing layer. `computed` and `effect` come from the same engine the signals come from.

**D-2. One subscription wiring.** `bindSignalWrites` / `guardUpdate` (the `runtime/bindings.ts` seam) is the only place a slot, a derived node or an author effect subscribes to a signal, and every subscription is released by the owning lifecycle scope. A mechanism that needs a *second* invalidation channel (a counter, a manual dirty flag, a hand-rolled listener) is a defect against this record.

**D-3. One lifecycle scope.** `instance` → `connection` → `projection` (`lifetime-scope.ts` + `instance-ledger.ts`) is the only lifetime hierarchy. Any derived node, subscription or retained record binds to one of those scopes; nothing reactive is element-lifetime by accident.

**D-4. One derived-state contract.** Derived state is authored as `const x = computed(() => expr)` and has one semantics across the lane:

- subject to the same binding-provenance admission as the lifecycle intrinsics (a top-level `computed(...)` in the component setup, canonical named import, aliases followed);
- erased by the compiler into an **instance-retained derived node** over the same engine, never a runtime dispatcher and never a hook-order slot;
- lazy, and cut by `Object.is` equality (`@preact/signals-core` semantics) so an equal recomputation does not propagate;
- read-only; assigning to it is a compiled diagnostic, not a runtime error;
- released with the owning scope; a reconnect re-creates it with the new connection, the retained instance keeps what the instance owns;
- **one evaluation per render on the server** (SSR builds no reactive graph and caches nothing across requests, matching the existing per-request setup evaluation);
- declaration-order and cycle errors fail closed at the authored span, exactly like the lifecycle intrinsics' placement verdicts.

**D-5. Props have one owner: `runtime/props.ts`, with tracked reads.** The shell's props record becomes the M04 primitive's record:

- the record's getters read **one version signal**;
- the version signal is the *only* props invalidation channel — the hand-written `propsChanged` counter and `bumpProps` are deleted, not aliased;
- the shell keeps what is genuinely element-specific (declaration defaults, attribute conversion/reflection, pre-upgrade reconciliation, JSON seed apply). Those write through the primitive; they do not own a second record;
- `createTrackedProps` gains the per-key write the element shell needs (a whole-record `replace` alone cannot express `el.value = x`), and that per-key write is the one public write path for both callers;
- a consumer-form test asserts the shell's props record **is** the primitive's record (same invalidation channel, same per-read getter semantics), not merely that it behaves like one.

**D-6. `propDeps` is re-evaluated for deletion.** It is the compensation for untrackable props. After D-5, the compiler may emit direct dependency wiring; whether `propDeps` is removed from the emitted ABI is decided by the D-5 evidence, not by preference, and its removal is a separate, byte-pinned slice.

**D-7. The gate that failed is extended.** Three guards are added by the implementation:

1. a seam row for the reactive props channel naming `runtime/props.ts` as the single owner, with the shell as a consumer;
2. a consumer-form test at the seam boundary (D-5's last bullet);
3. a repo-level reuse check: a new runtime primitive that duplicates an existing one must be caught. The cheap, checkable form: the seam registry gains the reactive channel rows (props, subscription, lifetime, derived state) so a future slice that adds a fourth invalidation channel has to delete or amend a row rather than quietly add code.

## P7 — the four questions

1. **Can the platform do this?** Partly, and the direction is the right one: TC39's signals proposal is the platform catching up to this mechanism, which is exactly why the contract is stated as a *deletable* layer over one engine (§Retirement). Nothing here re-implements a platform feature the platform already ships.
2. **Can the cost be paid at compile time?** Yes, and the decision keeps it there: dependency collection, placement verdicts and the derived-node emission are compile-time work; the runtime receives one signal-backed props record, one subscription seam and engine-native derived nodes. No new scheduler, no new graph data structure, no runtime dependency-tracking protocol.
3. **If it is runtime, does it read as platform code and honour the server contract?** The runtime pieces are the existing ones (`signal`, `computed`, `effect`, `AbortSignal` scopes). The server-side rule is explicit: SSR evaluates each derived value once per render and builds no graph, so the server contract is unchanged.
4. **Nearest prior art, and is the difference deliberate?** Solid (`createMemo`), Svelte (`$derived`), Vue (`computed`) — all one engine with compile-time wiring and engine-native derived nodes; our difference is that the *dependency set is known to the compiler* and is emitted rather than discovered, and that derived state is authored as a compiler-erased intrinsic rather than a hook call. The contrast being avoided is a second, hand-rolled invalidation channel (the counter), which no mature framework ships.

## Consequences

- `computed` becomes implementable without a new mechanism: the compiler already collects each expression's dependency set, and the props record will be trackable after D-5.
- `open-reading-shell` (21 computed) and `open-article-view` (6 computed) can be migrated on the generated lane instead of being blocked, and `www/app/layout.tsx` (30 computed) stops being a special case.
- The 2026-11-18 "no `computed`; inline instead" ruling is superseded by this record for the generated lane. Its text stays in the migration note as history (amend-never-rewrite); the migration note gains a dated later reading pointing here.
- Byte impact is measured, not assumed: the props getter gains one signal read; the counter and `bumpProps` disappear; the emitted `bindSignalWrites` lines are unchanged until D-6. The net is expected to be small and is recorded per slice.
- `createTrackedProps` stops being dead code (it becomes the one props primitive) or is replaced by a single equivalent in the same file — either way it has exactly one implementation and real callers.
- The 31 `propDeps` references become a measurable, removable surface after D-5 (D-6).

## Implementation order (evidence-gated, each slice its own commit)

1. **D-5 first** (it is the root): per-key write on the primitive; shell switches to it; delete the counter and `bumpProps`; seam row + consumer-form test; byte pins updated with a written reason.
2. **D-4 next**: `computed` intrinsic — lowering, placement verdicts, SSR-once rule, equality cut, lifecycle release, negatives (cycle, declaration order, assignment, placement outside setup).
3. **D-6 evaluation**: measure whether `propDeps` can be removed; if yes, a byte-pinned slice; if no, record the measured reason.
4. **Then the migrations** that were blocked: `open-reading-shell`, `open-article-view`, `layout.tsx`, and the remaining class modules.

No slice may land a compatibility shim that keeps both props mechanisms alive.

## Retirement condition (P5)

```
RETIRE the computed intrinsic WHEN the platform (TC39 signals) supplies the same
  derived-value semantics in browsers this project targets AND every shipped
  component's derived values can be expressed with the platform form ;
  VERIFY gate:source AND gate:release GREEN AT one SHA ; RECORD 16b-MN +
  public-interface-snapshot ; OWNER single owner
RETIRE the createTrackedProps wrapper WHEN the platform signal is the props
  backing directly AND both callers (leaf/recipe and the element shell) read it
  without a wrapper ; VERIFY gate:source GREEN AT one SHA ; RECORD the seam row
  deletion ; OWNER single owner
```

## What this record does not do

- It does not implement anything. Implementation is sliced above and each slice carries its own evidence.
- It does not change any public export, protocol type or ABI in this record; the snapshot changes (if any) land with the slices that cause them.
- It does not decide `propDeps` removal (D-6 is measurement-gated) and does not authorise a compatibility shim.
- It does not claim any milestone, gate, exit or release.
- It does not re-argue the 2026-11-18 ruling's *intent*; it records that the ruling's premise (untrackable props) is the defect being removed.

## Implementation record (2026-11-20): D-5 landed

The first slice of the order above is implemented in this tree.

- `packages/element/src/internal/compiled/runtime/props.ts`: `TrackedProps` gains
  **one** version channel (`version: WritableSignal<number>`), a **per-key**
  write (`set`, the write shape the element shell needs) and an **untracked**
  internal read (`read`, for the owner's own bookkeeping). `replace` keeps the
  whole-record semantics of the leaf/recipe path. All three share the one
  channel: an equal write reports no change and notifies nobody; a getter read
  registers the channel even for an `undefined` value.
- `packages/element/src/internal/compiled/generated-element/shell.ts`: the
  private `Map` backing store, the plain getters and the hand-written
  `propsChanged` counter with `bumpProps` are **deleted**. `createState` builds
  the declaration record once and hands it to the primitive; the shell keeps
  only its element-specific write paths (defaults, attribute
  conversion/reflection, pre-upgrade reconciliation, JSON seed apply) and reads
  internally through the untracked accessor.
- The emitted ABI **name** `propsChanged` stays, now naming the primitive's
  version signal rather than a counter this module bumps. That is deliberate:
  it keeps the emitted code and every byte pin unchanged, and the counter that
  used to back the name does not exist. `shell-props-single-owner.test.ts`
  fails on either a private record or a private counter.
- The three generated-element module-graph guards moved
  `/internal/compiled/runtime/props.ts` out of their "old Part Program backend"
  list. Those lists are about keeping the **executor** out of the generated
  bundle, and their own doc comment already allowed "neutral recipe/value
  primitives"; `props.ts` imports only the signal framework. The reclassification
  is part of the fix, not a relaxation: the shell may consult the one props
  record, and nothing in these lists now lets the executor in.
- Tracked-interface delta: `docs/release/public-interface-snapshot.json`
  regenerated — `TrackedProps` and `createTrackedProps` now publish `version`,
  `set` and `read` (internal subpath, no public API change beyond the tracked
  record).

Evidence (LOCAL, worktree at `8ce1010e1` + this tree): element 133 files /
1043 tests passed; compiler 95 files / 1386 tests passed; `vp run check` 5/5
PASS; `seams:check` 82 rows / 15 `ONE owner:` with the ratchet enforced;
`interface:snapshot` regenerated and matching. No behaviour claim is made for a
consumer of the generated lane beyond the suites above.

Still open from the order: D-4 (`computed` lowering), the D-6 `propDeps`
measurement, and the migrations that wait on both.

### D-4 status after D-5 (measured, 2026-11-20)

`computed` is **admitted and lowered** already: `GENERATED_ELEMENT_IMPORT_CLASSIFIER`
classifies it as a core factory (`generated-element/contract.ts:269,282`) and the
function frontend lowers the body as a `derived` expression
(`semantic-core/function-frontend.ts:1243-1245`). With D-5 landed, a computed
closed over `props` now tracks correctly — the 2026-11-18 staleness premise is
gone.

What still blocks it is the **binding source**, not computed itself: a computed
(like a `signal`) is a host binding the generated root must resolve, and the
root refuses with `OEIR_GENERATED_ELEMENT_UNBOUND_BINDING` because the shell's
`createBindings` remains allocation-only / fixture-only. So D-4's remaining work
is one slice: give the generated root a production bindings source (the retained
setup factory producing the bindings record, signals and computeds included) and
let the shell consume it.

`packages/compiler/__tests__/semantic-ir/generated-element.computed-boundary.test.ts`
pins the exact current refusal, so the slice starts from a measured fact and its
flip from "refused with this identity" to "emitted and tracked" is the evidence.

### D-4 slice plan (located against this tree, 2026-11-20)

The remaining work is seven edits, not a new mechanism. Insertion points, all in
`packages/compiler/src/internal/compiler/semantic-ir/generated-leaf/generate.ts`
unless stated:

1. **Create in the retained root factory.** In the `if (rootSetup)` block
   (`:8105`-`:8325`), emit one declaration per root `signal`/`computed` resource
   (`const x = signal(<initializer>);` / `const x = computed(() => <derivation>);`)
   and add the names to `recordFields` (`:8301`-`:8311`) so the factory's return
   record IS the bindings record. Both resources already carry their
   `IrResource.expression` (`semantic-ir/types.ts:79-85`); `signal` takes the
   initializer, `computed` the derivation body
   (`function-frontend.ts:1243-1245`).
2. **Enable the factory when bindings exist.** `rootSetup` (`:8063`) currently
   requires `localLines`/hooks/providers; add "the root declares signal/computed
   resources" to that disjunction. `setupReadsHostBinding` (`:8047`) counts reads
   of host bindings and must NOT count the resources the factory itself creates.
3. **The emitted bodies already read from the record.** `emitComponent`'s
   prologue binds each required name through
   `__oe_requireBinding = (name) => host.bindings[name]` (`:6586`-`:6592`), so
   mount/claim need no change: once the factory returns the record, the
   `host.bindings` lookup resolves. `requiredBindings` therefore stays populated
   (it is the read list, not a demand for an external source).
4. **SSR creates its own per-render copy.** The SSR path classifies the same
   resources as host bindings (`:7611-7612`); for the root it must instead emit
   the two declarations inline (the `resource.kind === 'local'` branch at
   `:7604-7611` is the template) and mark them local, because the SSR host record
   has no bindings channel and must not acquire one (per-render, no graph).
5. **Relax the gate, conditionally.** `gateGeneratedElementBindings`
   (`generated-element/site.ts:2156-2172`) refuses on any `requiredBindings`;
   it must refuse only when `leaf.rootInstanceFactory === null` — i.e. only when
   there is genuinely no production bindings source. A module with the factory
   has one.
6. **Runtime imports stay narrow.** Add `signal`/`computed` to
   `OPTIONAL_RUNTIME_IMPORTS` (`:323`-`:330`) with the existing body predicates,
   and re-export both from the closed `leaf-runtime` entry
   (`packages/element/src/internal/compiled/leaf-runtime.ts`, whose header already
   admits `signal/*`). Emitted modules must never import them from the package
   root: that entry carries the side effects P1 keeps out of an island chunk.
7. **Evidence.** Flip
   `packages/compiler/__tests__/semantic-ir/generated-element.computed-boundary.test.ts`
   from "refused with `UNBOUND_BINDING`" to "emitted, and the factory returns the
   record"; add a Chromium row that reads a props-derived `computed` through
   mount, claim and reconnect (the shell path already carries props + one
   invalidation channel); and re-run the byte pins, because every module that
   declares a computed gains the declaration lines and the import.

Risk that keeps this a slice rather than a patch: the change touches three
emission sites (mount, claim, SSR) plus the shared runtime-import table, so its
evidence must cover all three in one commit. A client-only version would ship a
component that works after hydration and fails during SSR — refused here.
