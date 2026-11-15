# ADR-0180: Release the function-component lifecycle intrinsics

- Status: ACCEPTED
- Date: 2026-11-15
- Owner ruling: 2026-11-15 — adopt **named intrinsics with a per-connection
  callback-returned cleanup** (`onConnect` / `onDispose`) as the author
  lifecycle surface; a component-returns-cleanup contract and a single-hook
  form were both rejected.
- Amends: ADR-0173 (`component(...)` and `onConnect` were unreleased candidate
  names there)
- Related: ADR-0174, ADR-0177, ADR-0163, ADR-0181

## Context

ADR-0173:33-34 recorded that "`component(...)` and `onConnect` are unreleased
candidate names, not public imports promised by this record", and fixed the
semantics that make them necessary: a client instance runs setup **once**, a
connection is a **separate phase**, and reconnect must not repeat setup. The
Alpha16b lifecycle slice landed the two intrinsics as public imports of
`@openelement/element` (`.`, `./base`, `./client-only`, `./no-blocks`) without a
carrier that converts the candidate name into released API. This record is that
carrier: it authorizes the names, fixes their contract, and records why the
shape is two intrinsics rather than a returned cleanup.

The gate that required this record: `design-principles.md` P2 ("runtime surface
needs an ADR") and P7 (the four-question review gate). `docs/adr/` was unchanged
by the slice, so the surface existed as an **unnamed deviation** — a defect under
`design-principles.md:16-19` until this record names it.

## Decision

Two compiler-recognized intrinsics, imported from `@openelement/element`, called
at the top level of an admitted generated-element **root** component:

```tsx
import { onConnect, onDispose } from '@openelement/element';

onConnect(() => {
  const timer = setInterval(tick, 1000);
  return () => clearInterval(timer);   // this connection's cleanup
});
onDispose(() => {
  /* element-lifetime teardown */
});
```

The contract:

| Aspect | Rule |
| --- | --- |
| `onConnect(cb)` | `cb` runs on **every** connection: the initial mount and each reconnect claim. Its optional returned cleanup runs at **that** disconnection and on a failed-connect rollback. |
| `onDispose(cb)` | Runs **exactly once** at element teardown (explicit dispose), **after** connection cleanups, under the existing first-error rule. |
| SSR | Never invoked. `<Root>__ssr` bytes are unchanged and run no hook. |
| Compiler | The intrinsics are **erased** at build time into the existing `__oe_rootInstance` factory plus a mount/claim replay prologue. No runtime dispatcher, no hook-order slot, no lifecycle context, no second lifecycle engine. |
| Ownership | `onConnect` cleanup registers on the shell's **per-connection** `connection` scope; `onDispose` registers on the **element-lifetime** `instance` scope (the LC-0 three-tier tree). |
| Outside the compiler | The imports throw the existing `JSX_OUTSIDE_COMPILER` identity instead of silently dropping the callback. No new public error code. |
| Hook scope in Alpha16b | **Root only.** Nested/hostless component hooks and connection-scope helper parameters stay inside `16b-LC` (OWED); a hook that reads a host binding keeps the existing `UNBOUND_BINDING` refusal. |

The two-intrinsic shape is the decision, not an implementation detail: a single
hook can express only **one** lifetime, while this framework separates
disconnection (release connection resources, retain setup state) from disposal
(release everything). Choosing one hook would either destroy setup state on a
plain disconnect or leak per-connection resources — both contradict ADR-0173.

## The four questions (P7)

1. **Can the platform do this? (P1)** The platform already delivers the
   connection signal (`connectedCallback` / `disconnectedCallback`) and the
   element lifetime (custom element upgrade/teardown). The slice adds author
   ergonomics over those platform phases; it adds no new runtime phase, no timer
   scheduler and no observable. `setInterval`, listeners and `AbortSignal` are
   the platform's.
2. **Can the cost be paid at compile time? (P2)** Yes: both intrinsics are
   erased. The only runtime artefact is generated code (a retained callback list
   plus a replay prologue in the emitted mount/claim), not framework runtime. A
   module that uses neither hook is byte-identical to its pre-slice output, and
   that identity is pinned by test.
3. **If it must be runtime, does it read as platform code and honor the server
   contract? (P3)** The callback runs synchronously inside the platform
   connection callback; there is no server path (the SSR producer does not run
   hooks), so no server contract is bent. The imports fail loudly outside the
   compiler rather than degrading.
4. **Nearest prior art, and is our difference deliberate? (P7.4)** React's
   `useEffect` returns a cleanup from a **named hook's callback**; Solid uses
   `onMount` plus a separate `onCleanup` registration. Neither makes a component
   return its cleanup. Our difference is deliberate and narrow: two named
   intrinsics **and** a callback-returned cleanup, because this framework's
   disconnect is not its disposal (ADR-0173). We deliberately do **not** adopt
   dependency arrays, hook-order slots, or React-style re-render-driven effect
   re-runs.

## Consequences

- Public surface: `onConnect` and `onDispose` on four element subpaths, recorded
  in `docs/release/public-interface-snapshot.json`. The tracked snapshot is the
  **source** baseline; the published packages remain `v1.0.0-alpha.15` and do
  not contain this surface, so nothing unversioned mutates a shipped artifact.
  The next release line carries it (no version bump in this change).
- The slice ships a greenfield surface, so no consumer migration is pending.
- `16b-LC` gains a delivered root half; its nested/hostless obligation and
  connection-scope helpers remain open rows in
  [the migration note](../architecture/16b-migration-note.md), **inside the
  existing slice** — this record introduces no new slice label.

## Retirement conditions (P5)

```
RETIRE onConnect / onDispose WHEN interface:snapshot no longer lists either name on
  the @openelement/element subpaths AND the authoring model that replaces function
  components lands ; VERIFY gate:source AND gate:release GREEN AT one SHA ;
  RECORD 16b-MN + public-interface-snapshot ; OWNER single owner
RETIRE the root-only hook boundary WHEN the 16b-LC nested/hostless rows go green in
  the signed capability inventory AND the corresponding emitter tests run at one
  clean SHA ; VERIFY gate:source GREEN AT that SHA ; RECORD 16b-MN row ; OWNER single owner
```

Both conditions are events on a standard artifact (`public-interface-snapshot.json`,
`gate:source`/`gate:release`), never a date or a "next review".

## Alternatives rejected

- **Component returns a cleanup.** Overloads the component return contract
  (JSX vs cleanup), cannot express disconnect-vs-dispose without a second
  channel anyway, and would run setup-time side effects in hostless/SSR mounts.
- **One hook (`onMount` style).** Loses the disconnect/dispose distinction fixed
  by ADR-0173; either leaks connection resources or destroys instance state.
- **Class-adapter parity.** Forbidden by the approved fourth pass (ADR-0173,
  no compatibility adapter).
- **Leaving the names unreleased while shipping them.** That is the unnamed
  deviation this record exists to end.

## Amendment (2026-11-16): nested/hostless depth-1 hooks delivered

This is an append-only fact record. The **root-only decision text above is
unchanged and is not re-decided here**; this amendment only records what the
`16b-LC` slice now delivers and the one reading it adopts.

Delivered (same `16b-LC` slice; the root half was already delivered):

- A direct top-level `onConnect`/`onDispose` intrinsic in a NON-root function
  component is admitted only when the component is a **depth-1 retained
  hostless child** of the generated-element root: its reference sits directly
  in the root body, is not inside a reusable JSX/list body, and the target is
  referenced only there. Its callbacks are recorded by that component's own
  real synthesis factory (`<Name>__setup`) in the SAME retained instance record
  namespace the root uses (`__oe_connect`); `onDispose` registers on the same
  instance owner. No dispatcher, hook-order slot, lifecycle context, second
  engine or author API is added. The child mount/claim prologues replay
  `__oe_connect` from `host.setup`; the root keeps `host.bindings`
  byte-for-byte, and hook-free modules and root-hook modules are unchanged.
- **Placement reading adopted by this slice (IMPLEMENTATION READING, not a
  re-decision):** a hostless child has no platform connection of its own, so its
  **connection is the lifetime of its projection insertion in the parent body** —
  the parent projection/connection ending runs the child's connect cleanups
  (parent disconnect), while **structural removal** (condition/target removal)
  or the **parent's instance-owner teardown** releases the retained child and
  runs its `onDispose` exactly once, after that connection's cleanup. This
  reading keeps "setup once per retained instance" and reuses the existing
  `LifetimeScope`/ledger cascade without a new channel. It is what this slice
  implements; the owner may later rule to change the semantics (for example a
  distinct child connection callback), in which case this amendment is
  superseded rather than treated as settled.
- Every placement outside depth-1 (depth ≥ 2, reusable JSX/list bodies,
  non-retained targets, or a module whose retention plan falls back to legacy)
  fails closed at the AUTHORED span with the existing
  `OEIR_LEAF_INVALID_ARTIFACT`; a hook that reads a host binding keeps the
  existing `UNBOUND_BINDING` refusal; the callback form rules (`OEC9042`) are
  unchanged.
- No public surface/snapshot change, no status flip: retirement condition 2
  remains open until the `16b-LC` nested/hostless rows go green in the signed
  capability inventory and the corresponding emitter tests run at one clean
  SHA.
