# ADR-0182: Function-component capability API (experience edition), workspace-package islands, and the property JSON seed channel

- Status: PROPOSED (draft; pending owner sign-off)
- Date: 2026-11-16
- Owner direction: 2026-11-16 — D1 = A (workspace-package generated islands
  migrate inside Alpha16, targeting the Alpha16 release line), D2 = the
  experience-edition capability API, D3 = B (a JSON seed channel for
  non-attribute properties). This draft records the direction; the formal
  sign-off line in "Sign-off status" is intentionally blank, and no signature,
  approval, milestone verdict, evidence or release authorization is recorded
  here.
- Related: ADR-0173, ADR-0174, ADR-0176, ADR-0180, ADR-0181,
  [the TSX author candidate contract](../architecture/tsx-author-candidate-contract.md),
  [the M09-2d property record](../architecture/m09-2d-nonprimitive-properties.md)

## Context

Alpha16b's generated (function-component) lane has landed the platform half:
the generated Native Custom Element shell, DSD SSR, server-rendered host
producers, the private retained-instance ledger and the declared-style sheet
channel (ADR-0180, ADR-0181, and the M09 slice records). The **author-side**
surface is still partial, and three gaps are the reason this direction exists:

1. **Lifecycle callbacks receive no environment.** The two root-only intrinsics
   `onConnect` / `onDispose` (ADR-0180) take no arguments, so a callback cannot
   reach the host element or a connection-lifetime cancellation signal without
   a second mechanism.
2. **The capability API set is unreleased and partly open.** The candidate
   contract lists `ref`, `context`, `provide`, `useContext`, `nativeElement` and
   `ErrorBoundary` as unreleased names with unselected signatures; TSX-12
   records the ref-timing boundary, and TSX-13 and TSX-19 carry OPEN items
   (context representation/lifetime/reactivity; boundary reset policy). The generated
   lane does not wire context today
   ([`m09-generated-element-shell.md`](../architecture/m09-generated-element-shell.md):199),
   and the public context primitives that exist are the host-side
   `provideContext` / `consumeContext` pair, not a generated-component scope
   tree.
3. **Property-only values have no server-to-client seed.** Non-primitive /
   `attribute: false` rows are property-only, with no attribute/JSON wire and no
   server-to-client seed; non-primitive seed parity is deliberately NOT proved
   and M11 owns a future transport
   ([`m09-2d-nonprimitive-properties.md`](../architecture/m09-2d-nonprimitive-properties.md):126,148).
   On top of that, the islands the docs site consumes from `@openelement/ui`
   (`open-button`, `open-code-block`, `open-theme-toggle`) are class-lane
   package components, while generated-lane admission today admits only island
   files with a local default-exported function component.

The owner direction of 2026-11-16 selects a coherent **experience edition** of
the capability API plus two enabling channels — workspace-package islands and a
property JSON seed — so the generated lane can be exercised by the product's own
component package inside Alpha16 without reopening milestones or freezing an
ABI.

## Proposed decision (pending owner sign-off)

This section is the proposed decision text. It is recorded as a **draft**
because the owner sign-off is pending; it is not an authorization to implement
any slice, and it claims no evidence.

### D-18a — D1 = A: workspace-package generated islands and the ui migration

The generated-lane island admission extends to **workspace package modules**
(authored in a workspace package such as `@openelement/ui`), and the three ui
islands the docs site consumes (`open-button`, `open-code-block`,
`open-theme-toggle`) migrate from the class lane to function/generated
components **inside Alpha16**, targeting the Alpha16 release line subject to the
release gates.

Boundaries recorded by this direction:

- It is **not** class retirement, a package split or rename, or a second
  admission mechanism; it extends the existing scan/admission path to modules
  that live in a workspace package.
- The route by which the build obtains the package-module site fact
  (workspace-source scan versus build-product metadata) is an **implementation
  decision** for the implementation slices; this direction does not select it.
- Whether the slice must also deliver the CEM live input and the ui package
  build/publish chain is an **implementation scoping decision**; this draft does
  not decide it and creates no obligation or waiver for either.
- No M09/M10/M11 status, P1 result or release claim moves by this direction.

### D-18b — D2 = the experience-edition capability API

The author capability surface for generated components is the following
**experience edition**. Each item is a compiler-erased intrinsic admitted by
binding provenance (the ADR-0180 recognition pattern); none of them is a runtime
dispatcher, a hook-order slot, a second lifecycle engine or a class adapter.

1. **Lifecycle `env`.** `onConnect` and `onDispose` callbacks receive
   `env = { host, signal }`. `host` is the owning generated custom element for a
   root, and the nearest ancestor generated element host for a nested hostless
   child. `signal` is an `AbortSignal` valid for one connection and aborted on
   disconnect (a reconnect gets a new signal). Zero-argument callbacks remain
   valid and behave exactly as today; the existing pre-DOM replay timing and
   scope structure are unchanged.
2. **`onError` error boundary.** An intrinsic declares a component-local error
   boundary that captures descendant failures with the containment and
   cleanup-completeness semantics of candidate case TSX-19. The boundary reset
   policy stays OPEN and is an implementation decision.
3. **`provideContext` / `useContext` scope tree.** Context is provided and
   consumed over the generated owner tree, hostless owners included, with
   nearest-owning-component lookup, sibling-subtree isolation and per-SSR-request
   isolation (the TSX-13 obligations). The default representation, provider
   lifetime and whether context values are reactive stay OPEN and are
   implementation decisions.
4. **Intrinsic element `ref` and `useHost`.** An intrinsic `ref` is assigned
   when the node is ready and released on removal; it is client-only (SSR is
   `n/a`) and its timing is not promised to match React. `useHost` exposes the
   owning generated host element to a component. Both are compiler-erased at the
   authored site.
5. **Component `ref` is FUTURE.** A ref to a component instance is explicitly
   **not part of this edition**; it remains a future decision (the candidate
   contract's dynamic-component-type item stays candidate), and this ADR creates
   no obligation to land it.

Experience-edition boundaries:

- **No stability promise.** "Experience edition" is a deliberate label: the API
  may change without a compatibility adapter until it is promoted (see
  "Consequences"). The candidate contract's unreleased-name status is unchanged
  for every name this record does not list.
- Every public export or tracked-interface delta produced by implementing this
  direction is enumerated in the implementation record and regenerated into
  `docs/release/public-interface-snapshot.json` in that same change, with the
  release owner's review recorded per the applicable authority — this draft does
  not pre-record that review or any signature.
- Only root and depth-1 retained hostless children are in scope where the
  lifecycle obligation reaches; depth ≥ 2 retention stays OWED and is not
  implied by `env.host` or `env.signal` (see ADR-0181's retention boundary).

### D-18c — D3 = B: the property JSON seed channel

Property-only declared values (`attribute: false` / non-primitive rows) cross to
the client through a dedicated **JSON seed channel** carried by the generated
host artifact; attribute encoding is not the chosen carrier.

Boundaries recorded by this direction:

- Only **declared property-only rows whose declared value type is
  JSON-encodable** are in scope. Values are JSON-safe and validated at the seam;
  no raw-markup channel is added and plain objects are never promoted to the
  `trustedHtml` brand.
- The `trustedHtml` crossing is **not decided here**: a brand cannot be
  reconstructed from JSON without a raw-markup channel, so its transport (or its
  exclusion from the seed) is a separate decision.
- The exact transport and wire encoding are **not decided here**. The existing
  record already assigns a future transport to M11
  ([`m09-2d-nonprimitive-properties.md`](../architecture/m09-2d-nonprimitive-properties.md):126);
  this direction selects a JSON seed shape for the property-only rows, not a
  transport implementation.
- Claim acceptance: an equal seed writes nothing during claim, and a
  structurally divergent seed fails closed through the existing claim-mismatch
  path (`OEIR_LEAF_CLAIM_MISMATCH`); a seed that cannot be validated must fail
  closed rather than fall back to the declared defaults silently.

## P7 four questions (draft)

1. **Can the platform do this?** Yes — every item maps to platform primitives:
   the Custom Element itself (host, connection lifetime, `AbortSignal`), the
   existing generated owner tree (context scope), and the emitted DSD host
   artifact (JSON seed). No new runtime phase is introduced.
2. **Can the cost be paid at compile time?** The intrinsics are compiler-erased
   and the env/context/ref wiring is generated code; the only shipped runtime
   cost is the boundary logic the implementation emits for participating
   components. Non-participating modules keep their bytes.
3. **If runtime, does it read as platform code and honor the server contract?**
   The env surface is a plain object over platform types; context lookup follows
   the existing owner/scope structure; the JSON seed rides the existing host
   artifact, and SSR keeps its existing text/attribute escape paths.
4. **Nearest prior art, and is the difference deliberate?** The prior art is the
   candidate contract's TSX-12/13/19 cases and ADR-0180's intrinsic pattern:
   compiler-erased calls, explicit `env`, no hook-order slots, no React timing
   promise, and context isolated by owner rather than by render-pass order.

## Consequences

- Implementation is split across slices; this record creates none of them and
  produces no evidence, status flip, gate result or release claim.
- Any public surface delta lands with its implementation record and regenerated
  snapshot; this draft only fixes the direction.
- The experience edition is **promoted to a stable author API only with
  consumer evidence** (the ADR-0174 G3 ordering), or retired; until then it
  carries no stability promise. The exact promotion evidence is a later owner
  decision.
- Package-island migration (D1) changes which lane the migrated ui components
  compile on; non-migrated package components keep the class lane and their
  bytes and behavior must not change in the same slices.
- The JSON seed channel (D3) removes the current "no server→client non-primitive
  seed" state for the declared JSON-encodable rows only; the `trustedHtml` and
  transport questions above stay open.

## Sign-off status (pending — intentionally blank)

| Field | Value |
| --- | --- |
| Owner direction recorded | 2026-11-16 (D1 = A, D2 = experience edition, D3 = B) |
| Owner sign-off | ____________________________ (pending; blank by design) |
| Sign-off date | ____________________________ (pending) |
| Formal amendment carrier | `docs/architecture/alpha16-18-execution-plan.md` §17 (draft, same pending state) |

This draft does not move itself from PROPOSED to an accepted record, and the
blank line is not a signature. A recorded owner sign-off is the only thing that
can do that.

Implementation slices may proceed under the direction recorded above (given by
the owner on 2026-11-16); the blank sign-off blocks any claim that a capability
is delivered, that a §17.3 evidence row is satisfied, or that any gate, exit or
release condition is met.

## What this record does not do

- It records no owner sign-off, no approval, no gate result, no P5 evidence, no
  milestone exit and no release qualification.
- It creates no version, tag, publication or public-API freeze, and changes no
  milestone or slice status.
- It does not implement D1's migration, D2's intrinsics or D3's seed, and it
  does not select the workspace-source-versus-build-metadata route, the CEM
  live-input scope, the ui package build/publish chain, the context
  representation, the boundary reset policy, the `trustedHtml` crossing or the
  seed transport.
- It does not retire the class lane, add a compatibility adapter, or claim a
  public ABI; component `ref` stays FUTURE.
