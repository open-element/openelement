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
   `env = { host, signal, states }`. `host` is the owning generated custom element for a
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

## Amendment (2026-11-16): the change channel — `onPropertyChange`

This is an append-only fact record. It adds ONE intrinsic to the
experience-edition umbrella that the five enumerated D-17b items do not cover;
it re-decides nothing above and creates no signature, gate, exit or release
claim. The owner may accept or revert it.

### Contract

| Aspect | Rule |
| --- | --- |
| Call site | A direct top-level `onPropertyChange(cb)` in the generated-element root setup, admitted by the same binding-provenance rule as the lifecycle intrinsics (a canonical named import of `@openelement/element`, aliases followed). |
| Callback form | One inline synchronous arrow/function expression; zero parameters or one event parameter. |
| Event | `{ host, signal, states, name, value }` — the generated element (the nearest ancestor generated element for a depth-1 retained hostless child), the instance-lifetime teardown signal, the element's `CustomStateSet`, the declared row's name, and its committed value. |
| Timing | After a DECLARED property commits a new value: a property write and an attribute write both fire it; an unchanged write does not. It never runs at setup. |
| Ownership | One element-lifetime registration on the instance host record; cleared when the instance is destroyed (explicit teardown or a failed first connect). Setup runs once per instance, so a reconnect does not duplicate it. |
| Byte identity | Emitted only for modules that use the intrinsic, and the registration channel is forwarded through host-record literals only for them. |
| Outside the compiler | The public import keeps failing closed with the existing `JSX_OUTSIDE_COMPILER` identity. |

### Why it is needed now

The three `@openelement/ui` islands that D1 = A migrates rely on
`attributeChangedCallback` side effects: `open-theme-toggle` propagates its
`theme` attribute to the document and dispatches `open:theme-change`, and
`open-button` syncs `:state(disabled)`. Without a change channel a migration
would silently drop those side effects on a PUBLISHED attribute, which is a
behaviour regression rather than an implementation detail.

### P7 (short form)

1. **Platform (P1).** The trigger is the platform callback the shell already
   owns (`attributeChangedCallback` and the property setter); the slice adds no
   observer, scheduler or reactive graph.
2. **Compile time (P2).** Fully erased. The only artefact is one registration
   call in the setup factory, emitted only for modules that use the intrinsic.
3. **Runtime posture (P3).** The callback runs synchronously inside the existing
   property write; the env is built by the shell from the existing instance
   signal. No server path.
4. **Prior art (P7.4).** React re-runs an effect when dependencies change; this
   is deliberately narrower — one event per committed declared row, no
   dependency tracking, no ordering slots, no batching.

### Boundaries

- Declared property rows only; a change to a non-declared own property is not
  reported.
- No dependency tracking, no batching, no re-entrancy policy beyond "run every
  listener, then surface the first error".
- Placement follows the lifecycle intrinsics: depth >= 2, recipe/list bodies and
  non-retained targets keep the existing authored-span refusals.

## Migration record (2026-11-16): the first component, `open-theme-toggle`

The owner approved the class-export retirement for migrated components on
2026-11-16 (direction D1 = A). This record applies it to the first component and
states exactly what the public surface loses and keeps.

### What migrated

`packages/ui/src/open-theme-toggle.tsx` is now a function component with a
sidecar (`defineComponentConfig({ root: 'shadow', delegatesFocus: true,
styles: ['./open-theme-toggle.css'], properties: { theme: { default: 'dark' } } })`).
The compiler emits `OpenThemeToggleElement`; the build's generated entry defines
it. The behavior is the class's: attribute > document > storage > media priority,
per-instance resolution, document convergence, dual-state transitions,
click-only persistence, `open:theme-change` with `{ theme }`, `::part`
toggle/icon-sun/icon-moon, the `data-theme` sink on the button.

### Public-surface delta (enumerated)

- `@openelement/ui` no longer exports the `OpenThemeToggle` **class**. The same
  name is exported as the authored function component; it is not constructible.
  The element constructor exists only in the build output
  (`customElements.get('open-theme-toggle')` after registration).
- `registerOpenUi` no longer defines that tag; the generated entry defines it
  from the manifest declaration. The manual table keeps the five class-authored
  components.
- The manifest/CEM declaration for the tag becomes a generated one: emitted
  class name, no public superclass, `root: 'shadow'`, the authored `styles`
  list, the same attribute, event and part names.
- `docs/release/public-interface-snapshot.json` is regenerated (class type
  replaced by the function type; `assertElementInNamespace` added to the
  element runtime's internal compiled surface for SVG claims).

This is a breaking TypeScript-surface change for consumers that imported the
class to instantiate or register it themselves. Consumers of the tag, the CSS
parts, the attribute or the event see no change.

### Evidence

`www/e2e/theme-toggle-instances.spec.ts` (priority chain, multi-instance
independence, document convergence, attribute-driven no-persist, reconnect
exactly-once, mount/claim parity), `www/e2e/theme-system.spec.ts` and
`www/e2e/ui-behaviour-matrix.spec.ts` (shipped behavior, parts, no-JS styling),
the ui unit suites (manifest coverage, smoke, contract) and the compiler
artifact suites. LOCAL.

### One capability this migration required: SVG subtrees

The component's icons are an `<svg>` subtree. The generated lane previously
created every element with `document.createElement` and claimed every element
with the HTML ancestor walk, so an SVG subtree would be HTML-namespaced in a
mount and refused by a claim (`non-HTML namespace`). The emitters now create an
`<svg>` subtree with `createElementNS(SVG)`, the claim asserts the element's OWN
namespace inside it, and camelCase SVG tags (`foreignObject`, `linearGradient`)
stay outside the admitted lowercase tag grammar. Existing HTML-only modules keep
their bytes.

Nothing in this record claims a stability promise, an owner sign-off, a gate or
a release condition.

## Migration record (2026-11-16): the second component, `open-code-block`

`packages/ui/src/open-code-block.tsx` is a function component with a sidecar
(`root: 'shadow'`, the authored stylesheet, and the property-only `copyLabel`
row). It keeps the copy contract: the button reads the slotted light DOM, the
clipboard promise writes `copyLabel`, the property-change callback owns the
`:state(copied)` / `:state(failed)` feedback and the reset timer
(`copy-feedback.ts`, a module helper — not component state), and `onDispose`
cancels a pending reset. `@openelement/ui` no longer exports the
`OpenCodeBlock` class; the authored function takes the name, the manifest/CEM
declaration becomes generated, and the manual registration table drops the tag.

Evidence: the www behaviour-matrix copy-control rows, the `::part(copy)`
reachability row and both shipped colour-pair contrast rows against the real
element; ui manifest/smoke suites. LOCAL.

## Migration record (2026-11-17): the third component, `open-dialog`

`packages/ui/src/open-dialog.tsx` is a function component with a sidecar
(`root: 'shadow'`, `delegatesFocus: true`, the two authored stylesheets in
authored order, and the `open` (reflect) / `label` rows). The imperative
top-layer/modal choreography and the close-echo guards (#1030, #1226) moved
verbatim into `dialog-machine.ts`, a module helper in the `copy-feedback.ts`
shape whose functions take the host explicitly; the component drives it from
`onConnect` (one rAF-deferred sync, cancelled through the connection signal)
and `onPropertyChange` (declared `open` rows only). `@openelement/ui` no longer
exports the `OpenDialog` class; the authored function takes the name, the
manifest/CEM declaration becomes generated (`OpenDialogElement`, no public
superclass), the manual registration table drops the tag, and the interface
snapshot is regenerated (class type → function type; the `./open-dialog`
subpath gains the `default` function and the `openElement` facts).

### Public-surface delta (enumerated)

- The class's `show()` / `close()` / `toggle()` methods are **retired with the
  class export**. The generated lane has no authored-method capability, and
  the three methods were property sugar over the declared `open` row:
  `el.open = true` / `el.open = false` are the programmatic paths. Consumers
  of the tag, the attribute, the event or the parts see no change; consumers
  of the sugar must switch to the property. This is the first migration whose
  class surface exceeded the export itself — recorded here because the
  snapshot diff makes it visible, not silent.
- The manifest event declaration survives (`open-dialog-close`, CustomEvent):
  the user-facing close dispatch is authored inline in the component module
  (the manifest event recognizer is module-local) with
  `new globalThis.CustomEvent(...)` (the function lane's value allowlist has
  no bare DOM globals). The cancel and native-close paths share the same two
  lines through the helper.
- SSR parity: the generated host wrapper reproduces the class lane's DSD
  marker byte-for-byte (`<open-dialog label="..."><template
  shadowrootmode="open" shadowrootdelegatesfocus>`); the inner dialog's
  attribute ORDER differs (seed order, not authored spelling), so two dogfood
  assertions moved from attribute-order literals to atomic facts.
- Style delivery: the generated lane's declared-sheet channel emits the same
  sheets the class lane bundled; a client-created (never server-rendered)
  generated host takes no constructed sheet today — the recorded Alpha17
  adoption slice. The dogfood constructed-sheet-sharing row therefore pins the
  class-lane contract on `open-dropdown` (still class lane) and documents the
  generated delivery.

### One router capability this migration required: the shared-sheet plan join

`overlay-recipe.css` is the first sheet shared between a generated island
(declared) and a class island (authored import). The style-edge registry keys
a shadow edge by its sheet file, so the sheet carries ONE registry entry under
whichever importer registered last, and the per-importer request lists cannot
join a shared sheet to its emitted asset. The client build's join and the dev
URLs now compute the registry KEY the declaration's registration used
(`styleRequestModuleId`) and read the emission state directly — per importer
attribution is no longer a join input. The A6 disposition (emitted and
unreferenced for www-unrendered declarations) is unchanged and still passes;
its sheet derivation reads the sidecar list for generated-lane modules.

### Evidence

`tests/fixtures/router-ui-dogfood` e2e (the dialog qualification page: SSR/DSD
markup, claim + hydration, SSR-open #1030 choreography, trigger/Tab/Escape
focus containment, exactly-one close event, reconnect) — 33 specs ×
chromium/firefox/webkit = 99 passed; the element browser overlay-contract
suite against the generated fixture (10 tests, including a programmatic
open-property top-layer row); the ui unit suites (84: the state-machine rows
now drive the helper directly, the dispose row moved to the browser evidence
per the harness contract); compiler 1265 / element 970 / router 1845 / www +
tools + create + saas + tests 1268 (+1 skipped); the www behaviour matrix and
the A6 sheet-admission suite. `pnpm run check`. LOCAL.

P1 is unaffected by this slice: `open-dialog` was never a www island, so the
browser-entry-graph verdict and the remaining class-island set are unchanged.

## Migration record (2026-11-17): the fourth component, `open-dropdown`

`packages/ui/src/open-dropdown.tsx` is a function component with a sidecar
(`root: 'shadow'`, the two authored stylesheets, and the property-only
`anchorName` row). The component is deliberately machine-free: the content is
a native `popover` (top layer, built-in light dismiss) positioned by CSS
anchor positioning, so the imperative surface is exactly the realm-unique
anchor-name assignment and the cross-shadow focus-return restoration (#1226)
— `dropdown-machine.ts`, the same module-helper shape as `dialog-machine.ts`.
A behavior library (Zag) was evaluated for this component and declined: the
component has no menu semantics (no items, roving focus or typeahead), the
platform already owns the hard parts, and the library's popover machine would
replace the native popover + anchor channel with JS positioning. Zag stays
the recorded behavior-layer choice for a future component that actually needs
menu/combobox semantics — the site's search combobox already runs
`@zag-js/vanilla` in production (`VanillaMachine` + `spreadProps`), which is
the proof form of that pattern.

### Public-surface delta (enumerated)

- The class's `anchorStyle` readonly signal — a derived
  `position-anchor: ${anchorName}` — is retired with the class export (the
  generated lane has no authored getter capability). The declared `anchorName`
  property survives (property-only row), and the anchor's host half applies at
  activation. The interface snapshot is regenerated (class type → function
  type); the manifest/CEM declaration becomes generated
  (`OpenDropdownElement`, no public superclass) and the manual registration
  table drops the tag.
- SSR parity: the generated host wrapper reproduces the class lane's DSD
  bytes; the content div's static surface (class/part/popover) is unchanged,
  and the closed element carries no runtime style.

### Two build/runtime facts this migration established

1. **The content's runtime style lives only inside the open window.** A
   reconnect re-claims the retained nodes against the compiled static seeds
   (`OEIR_LEAF_CLAIM_MISMATCH`), so a runtime-written inline style on a
   compiled element counts as an extra static attribute and fails the claim.
   The `position-anchor` half is therefore applied at `beforetoggle`
   (synchronously before the open can be observed) and dropped at the
   synchronous `beforetoggle(closed)` point and on dispose — the closed
   element's static surface always matches the compiled declaration, and the
   queued `toggle` task never gates it.
2. **Popover `beforetoggle`/`toggle` events neither bubble nor compose.** A
   `composed: false` event's propagation truncates at the shadow boundary —
   the host (or anything light-side, document capture included) never sees
   them. The focus-return listeners wire on the retained SHADOW ROOT in
   capture phase (the shell attaches the root before mounting, so the root
   exists at hook time while the nodes do not), with focus events filtered by
   composed path (a slotted light-DOM element's path runs through the slot
   into the content; the trigger's path — slotted into the trigger wrapper —
   does not).

Evidence: the dogfood dropdown qualification (anchor pair contract, toggle
guard, Escape/outside light dismiss, focus return, reconnect) — 33 specs ×
chromium/firefox/webkit = 99 passed; the element browser overlay-contract
suite against the generated fixture (10 tests, the anchor-pairing reconnect
row included); ui 84; compiler 1265 / element 970 / router 1845 / www + tools
+ create + saas + tests 1268 (+1 skipped); manifest/CEM/interface snapshot
regenerated and checked; `pnpm run check`. LOCAL. P1 unchanged (open-dropdown
is not a www island; the five www-local class islands remain the P1
remainder).

## Amendment (2026-11-17): the migration products' reconnect/session defects fixed at the consumer boundary

Facts-only correction of the fourth record's two "established" claims and the
third record's session bookkeeping; no row, milestone or verdict moves. Found
by a reviewer consumer audit, reproduced end to end at `aa1f949d9` on the real
compiled dogfood fixture (Chromium) and fixed entirely inside
`packages/ui` (no compiler or element-shell change).

### Correction 1 — the "closed element's static surface always matches" premise was false

The record stated the runtime content half is "dropped at the synchronous
`beforetoggle(closed)` point and on dispose", keeping the closed surface
exactly the compiled declaration. Two real paths broke that premise:

1. This engine leaves a residual `style=""` attribute when `removeProperty`
   takes out the last declaration. The claim counts ATTRIBUTES, not
   declarations (`staticAttributeSeedMismatch`), so the empty attribute was an
   extra static seed member and every open→close→disconnect→reconnect threw
   `OEIR_LEAF_CLAIM_MISMATCH: static attribute seed count is 4, declared 3
   (authored packages/ui/src/open-dropdown.tsx:94:7)` — the component was
   dead after the reconnect. Reproduced on the compiled fixture.
2. Disconnecting while the popover was open left the runtime content half in
   place (no closed `beforetoggle` reached the detached root), and the
   reconnect re-claim failed on that residue the same way. Also reproduced.

Fixes (consumer boundary): the drop helper removes an EMPTIED `style`
attribute itself (an authored declaration never touches it), and the
component's per-connection abort drops the content half at disconnect
(dialog-machine's `env.signal` precedent). The dogfood qualification and the
`element-browser` overlay-contract suite pin both reconnect paths plus the
`hasAttribute('style') === false` closed surface.

### Correction 2 — a rename inside the open window kept the content half stale

`syncDropdownAnchor` applied only the host half, so an author rename while the
popover was open left `position-anchor` naming a value that no longer existed
— the popover lost its anchor for the whole open window (reproduced). The
sync now re-applies the content half inside the open window; the closed
surface invariant is unchanged (no write while closed).

### Correction 3 — the focus-return wiring is connection-scoped

The wiring was once-per-host with no removal path (no signal, no dispose). It
now records its three listeners, drops them on the connection signal's abort
and again at element-lifetime teardown (idempotent), and the queued restore
microtask refuses to move focus when the host is no longer connected — a dead
connection owns no focus decisions. No engine observed fires the closed
toggle on a detached tree, so the guard row drives the exact close with a
synthetic `ToggleEvent` on the detached content.

### Correction 4 — dialog: a lost top-layer session re-enters instead of a zombie

Disconnecting an open modal host drops the platform's `:modal` membership
while the machine's `modalActive` bookkeeping and `dialog.open` survive on the
retained nodes; the reconnect sync early-returned and left an open dialog with
no backdrop, focus containment or inert (reproduced: `dialogOpen: true,
modal: false` after reconnect). `syncDialogElement` now verifies the live
session (`dialog.matches(':modal')`) before early-returning; a lost session
re-enters through the existing #1030 close-first dance. The `open` attribute
itself stays claim-exempt (a dynamic sink in the emitted seed's skip list) —
verified against the emitted-claim generator, no shell change needed or made.

### Evidence

Node (ui project): the four new lifecycle rows (connection-signal dispose +
re-wire, open-window rename, emptied-attribute removal, lost-session
re-entry). `element-browser` overlay-contract: five new rows (close→reconnect
toggle, disconnect-while-open→reconnect, open-window rename, dead-connection
focus guard, dialog lost-session re-entry). Dogfood e2e: the closed-surface
`hasAttribute('style')` tightening plus the reconnect-after-close,
rename-while-open and dialog reconnect rows. LOCAL runs recorded with the
implementation commit; no clean-SHA gate claim is made by this amendment.

## Amendment (2026-11-17): the light-root SSR producer row (B4)

Append-only fact record. It adds ONE internal descriptor member and the
serializer branch that reads it; it re-decides nothing and creates no public
API promise.

### What was missing

A LIGHT (or absent) root's leaf already emitted the parameterless
`<Name>__ssr()`, but nothing reached it at request time:
`entry-orchestrator.ts` deliberately produces no `<Name>__ssrHost` for a light
root ("never has a host producer by design"), and `renderToString` only
dispatched through the generated-host registry pair — so every light-root
generated island failed closed with `OE_PROGRAM_MISSING`.

### The contract this amendment adds

- **Descriptor member (shell-internal).** `GeneratedElementDescriptor.ssrProducer?:
  () => string` — the compiler emits it ONLY for a light/absent descriptor root
  whose leaf really emitted `<Name>__ssr`, and the shell attaches it as the
  class's static `__ssr` (one class = one registration; an unregistered light
  host still fails closed).
- **Serializer branch.** `renderToString` — root AND nested — calls that static
  when the resolved class carries no Part Program, wraps the produced content in
  the host element with the canonical attribute pairs (`serializeLightGeneratedHost`),
  and fails closed on a non-string result. The producer stays content-only: a
  light root's region IS the host's children, which is why the wrapper is the
  serializer's job and not the producer's.
- **Byte contract.** A light-root module that emits a producer gains exactly one
  descriptor line. The A8/R5/R6 byte pins moved ONCE for that capability; the
  test bodies now also assert the row's presence so the change cannot be
  re-inherited silently.

### Static boolean attribute spelling (same change set)

The generated lane spelled a JSX boolean shorthand (`muted`, `loop`,
`playsinline`) as `setAttribute(name, "true")` at three emission sites (mount,
M08-1a static SSR, M08-1b dynamic SSR) plus the claim static seed, while the
HTML parser and the class lane spell presence as `name=""`. All four sites now
emit the canonical empty value, so a created element and the same element
parsed from SSR bytes agree byte-for-byte. Found by the `cinematic-home` e2e
suite, which asserts `muted=""`.

Evidence (LOCAL): the migrated `open-dragon-live-gaze` / `open-cinematic-scroll`
islands build, serve, hydrate and pass `cinematic-home.spec.ts` 12/12 in
chromium; compiler 1279, element 970, router 1845, ui 86, `pnpm run check`.
The island migrations themselves are NOT landed: they exceed the www client-JS
budget (352.8 KB vs the 344 KB SLO), which is a separate product decision.
