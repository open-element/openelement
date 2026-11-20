# ADR-0182: Function-component capability API (experience edition), workspace-package islands, and the property JSON seed channel

- Status: ACCEPTED (owner sign-off 2026-11-19)
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
| Owner sign-off | SisyphusZheng (verbal approval in review session, recorded 2026-11-19) |
| Sign-off date | 2026-11-19 |
| Formal amendment carrier | `docs/architecture/alpha16-18-execution-plan.md` §17 (draft, same pending state) |

This draft does not move itself from PROPOSED to an accepted record, and the
blank line is not a signature. A recorded owner sign-off is the only thing that
can do that.

Implementation slices may proceed under the direction recorded above (given by
the owner on 2026-11-16); the blank sign-off blocks any claim that a capability
is delivered, that a §17.3 evidence row is satisfied, or that any gate, exit or
release condition is met.

**Sign-off amendment (2026-11-19):** the owner approved this record verbally in
the 2026-11-19 review session and the sign-off line above now carries that
record. The paragraph above is kept as history of the pre-sign-off state; the
accepted record is the current text.

## Retirement conditions (P5)

```
RETIRE onError / onPropertyChange / the env.states channel WHEN interface:snapshot
  no longer lists the names on the @openelement/element subpaths AND the authoring
  model that replaces function components lands ; VERIFY gate:source AND
  gate:release GREEN AT one SHA ; RECORD 16b-MN + public-interface-snapshot ;
  OWNER single owner
RETIRE the ./lifecycle public subpath WHEN interface:snapshot no longer lists it AND
  every shipped intrinsic is reachable from the root subpaths alone ;
  VERIFY gate:source GREEN AT one SHA ; RECORD 16b-MN + snapshot ; OWNER single owner
RETIRE the ./internal/compiled/leaf-runtime internal subpath WHEN the Alpha17
  precompiled distribution replaces the closed leaf entry AND no emitted module
  imports it ; VERIFY gate:source GREEN AT one SHA ; RECORD 16b-MN row ;
  OWNER single owner
RETIRE the workspace-package island site admission WHEN the P1 browser-entry-graph
  artifact reports MET for every applicable production app at one clean SHA AND
  the package-island branch of the entry scan carries the same lane fact as local
  islands ; VERIFY gate:source AND gate:packed GREEN AT that SHA ;
  RECORD 16b-MN + browser-entry-graph evidence ; OWNER single owner
RETIRE the data-oe-prop-seed JSON seed channel WHEN a canonical server→client seed
  contract replaces the attribute carrier or the capability is removed ;
  VERIFY gate:source GREEN AT one SHA ; RECORD 16b-MN + the M09-2d amendment ;
  OWNER single owner
```

Each condition is an event on a standard artifact (`public-interface-snapshot.json`,
`gate:source`/`gate:release`, the P1 browser-entry-graph report), never a date
or a "next review".

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

## Amendment (2026-11-17): the package-island SSR host identity (B9)

Append-only fact record. It adds ONE manifest field and the scanner read that
turns it into the identity the entry already understands; it re-decides nothing.

### What was missing

A **local** island's scan resolves a `generatedElementHost` identity
(`resolveGeneratedElementHost`) and the entry pairs it through
`__registerSsrIsland(tag, ctor, hostRenderer)`, which is what makes its SSR emit
a DSD `<template shadowrootmode>`. A **package** island only had its STYLE
declarations registered (`packageIslandStyleDeclarations`), so
`generatedHostExports.get(tag)` was always `undefined` for it and the entry fell
back to `__registerSsrComponent` — the class path. Consequence: a migrated
package component server-rendered as a bare host tag with no DSD, so the client
had nothing to claim, no listener was ever installed, and its form value never
reached `FormData`.

### The contract this amendment adds

- **Manifest field.** `openElement.ssrHostExport?: string` — the compiler's
  return-only `<Name>__ssrHost` name, published by the package's own manifest
  generator from `CompiledGeneratedElement.ssrHostExport`. Absent for a class
  declaration and for a LIGHT-root generated one (a light root serializes
  through the shell-attached `__ssr` static, which the entry resolves from the
  class).
- **Scanner read.** `buildPackageIslandDecls` turns a published name into the
  SAME `{ kind: 'producer', component, ssrHostExport }` identity a local scan
  produces, so one entry path serves both. The name is never re-derived from a
  `<X>__ssrHost` convention in the router — that is exactly the drift this ADR's
  M11 record forbids.

Evidence (LOCAL): the dogfood `/form` page now server-renders `<open-input>`
with `<template shadowrootmode="open" shadowrootdelegatesfocus>` and its style
links; `ui-form.spec.ts` 6/6 in chromium (FormData carries the typed value,
required blocks submission, reset clears, fieldset disabled drops the entry,
delegatesFocus + per-input events), dogfood 105 × three engines, compiler 1279,
element 970, router 1845, ui 86, www+tools+create+saas+tests 1268 (+1 skipped),
`pnpm run check`.

## Implementation plan record (2026-11-17): D-18c's JSON seed, the four landing sites

D-18c chose the direction; this records where it lands and what must be true
before it ships, because the B8 slice is blocked on all four agreeing.

1. **Producer (emitter).** The host wrapper reads the non-primitive rows the
   content producer actually READ — never a separate eager pass. The suite that
   pins the supplied-getter contract (`generated-element.nonprimitive-properties.test.ts`
   "supplied getters are read per read") fails the moment a prologue starts
   reading rows to build a seed, so the read must be RECORDED at the sink, not
   anticipated. The seed travels as one JSON payload on the host artifact.
2. **Wire (dsd-ssr + host attributes).** The payload needs a host attribute;
   `serializeGeneratedElementHtml`'s attribute writer validates names and values
   and rejects duplicates, so the payload is a single declared name with a
   string value. It joins the claim's `dynamicNames` set (the existing
   "the shell writes this slot itself" exclusion) instead of the static seed.
3. **Consumer (shell claim).** On claim, the shell parses the payload, validates
   it against the declared row TYPES (a structurally divergent seed fails
   closed through `OEIR_LEAF_CLAIM_MISMATCH`, never a silent default), and
   writes the values before setup runs. An equal seed writes nothing.
4. **Boundary.** `trustedHtml` stays OUT (a brand cannot be reconstructed from
   JSON; D-18c records that as a separate decision). Non-JSON-encodable declared
   types stay out. Plain objects are never promoted to the brand.

Why it is not landed yet: steps 1-3 each touch exact-byte assertions
(emitter bytes, DSD bytes, claim seeds) and the change is only correct as a
whole. Its own evidence matrix is S/K/U/D plus a divergence negative, and it
unblocks `open-search` (`hits: SearchHit[]`), `notes-live`
(`events: Array<{id, body}>`) and `open-page-rail` (`items: RailItem[]`).

## Amendment (2026-11-20): carrier and sign-off state

Append-only fact record. Owner-approved 2026-11-20 under the delegated
in-session remediation authorization recorded in
[execution-plan §18](../architecture/alpha16-18-execution-plan.md) (§18.7 for the
record form). It re-decides nothing in the sections above; where they describe a
pending state, this is the later reading.

- The **approved carrier** of this record's direction is now execution-plan §18.
  §17 stays as written: its "draft; formal sign-off pending" title, its
  intentionally blank §17.2 table and its "this draft does not move itself"
  paragraph are the **historical state of the pre-2026-11-20 carrier**, not a
  current blocker and not a signature in force.
- This record's own head is read the same way. The "Proposed decision (pending
  owner sign-off)" heading, the "Sign-off status (pending — intentionally
  blank)" heading and carrier row ("§17 (draft, same pending state)"), and the
  "What this record does not do" sentence "It records no owner sign-off" are
  kept as written for the same reason; the accepted state is: the direction was
  owner-approved (2026-11-16 direction; the 2026-11-19 verbal sign-off already
  recorded above; the decisions of the 2026-11-20 remediation recorded in the
  amendments below under the delegation in plan §18.7). The blank line in
  "Sign-off status" is still not a signature and this amendment does not fill
  it.
- What the old pending state blocked is now stated precisely: the capabilities
  whose delivery is recorded in this file's 2026-11-20 amendments are delivery
  facts of their implementation records (plan §18 carries the authority); this
  ADR records no gate, milestone exit, P5 evidence or release result of its own,
  and the §13.5 P5 sign-off remains the owner's own line in the consolidation
  PR (plan §18.6).

## Amendment (2026-11-20): the two public subpaths — `./lifecycle` and `./document-services`

Append-only decision record. Owner-approved 2026-11-20 (delegated in-session
remediation authorization; plan §18.7). It authorizes the two public export
subpaths this change publishes and enumerates their interface. It creates no
version, tag, publication, public-API freeze, milestone exit or release claim.

### Decision

`@openelement/element` publishes two **public** export subpaths beyond the
surface this record originally enumerated:

- `./lifecycle` → `src/lifecycle.ts`: the compiler-erased author intrinsics
  `onConnect`, `onDispose`, `onPropertyChange`, `provideContext`, `ref`,
  `useContext` — six public symbols in the regenerated
  `docs/release/public-interface-snapshot.json`.
- `./document-services` → `src/document-services.ts`: the generated-lane page
  floor — `deepGetElementById`, `ensureDeepFragmentNavigation`,
  `ensurePreHydrationClickCapture` — three public symbols in the same snapshot.

Why the subpaths exist, and why they are **public** rather than `/internal/*`:

- `./lifecycle` is author-facing. The package root is flagged in `sideEffects`
  (it carries the hydration and Block install edges), so an author module that
  imports these intrinsics from the root drags the generic executor into the
  browser graph for bindings the compiler then deletes. The subpath is a
  deliberate facade: it re-exports the fail-closed stand-ins from
  `internal/core/compile-lifecycle.ts`, has no side effects and reaches no
  executor entry (`packages/element/src/lifecycle.ts`).
- `./document-services` is the narrow page floor the generated client entry must
  install statically once every island is generated-lane and no runtime loader
  is emitted; without it a fully generated page silently loses deep fragment
  navigation and the bounded pre-upgrade click capture
  (`packages/element/src/document-services.ts`; the seam and its missing-behaviour
  contract are registered in `docs/architecture/seams.md`).
- Both subpath targets live **outside** `internal/`, i.e. both are deliberate
  facade modules, so ADR-0137 §1 ("public package entries expose deliberate
  facade modules and never name an `internal/` module") is honored without an
  exemption. The third new subpath this change publishes,
  `./internal/compiled/leaf-runtime`, is the one that needs a named deviation —
  ADR-0177 carries it (see that record's 2026-11-20 amendment).

### P7 four questions

1. **Can the platform do this?** Yes — both are ordinary package `exports`
   entries over modules that already exist; no new mechanism, registry or second
   resolution path is introduced.
2. **Can the cost be paid at compile time?** Yes — `./lifecycle` is entirely
   compile-time: the compiler erases the calls into the generated instance
   factory and the emitted module imports nothing from the subpath.
   `./document-services` adds no implementation (three re-exports) and installs
   by call rather than by import side effect, so it stays tree-shakeable.
3. **If runtime, does it read as platform code and honor the server contract?**
   `./lifecycle` never runs — outside the compiler pipeline its stand-ins fail
   closed with the existing `JSX_OUTSIDE_COMPILER` identity. `./document-services`
   runs document-level listeners installed by the generated entry and adds no
   server path; no SSR bytes change.
4. **Nearest prior art, and is the difference deliberate?** The prior art is the
   repository's existing deliberate facade subpaths (`./client-only`, `./no-blocks`,
   `./base` under ADR-0155/ADR-0166) and the emitted-code artifact-resolution
   deviation (ADR-0177). The difference is deliberate: these two facades exist so
   the author's and the page floor's graphs can stay executor-free — the P1
   defect this change removes — while their targets stay outside `internal/`, so
   ADR-0137 §1 is not deviated from.

### Retirement conditions (P5)

The block "Retirement conditions (P5)" above already owns the `./lifecycle` row;
this amendment adds the `./document-services` row and states that both are
predicates on existing artifacts at one SHA, never dates or "next reviews". This
record remains the single owner of both events (§17.4-style; no second owner).

```
RETIRE ./lifecycle WHEN interface:snapshot no longer lists it AND every shipped
  intrinsic is reachable from the root subpaths alone ; VERIFY gate:source GREEN
  AT one SHA ; RECORD 16b-MN + snapshot ; OWNER single owner
RETIRE ./document-services WHEN a page whose islands are all generated-lane can
  load the element runtime again, so the shell owns the two document-level
  installs AND the router wrapper element-document-services.ts is deleted with
  this surface AND interface:snapshot no longer lists it ; VERIFY gate:source
  GREEN AT one SHA ; RECORD 16b-MN + snapshot + the seams.md row ;
  OWNER single owner
```

The `./document-services` condition is the same event `docs/architecture/seams.md`
records for the page-floor seam ("RETIRE this seam when the shell owns these
installs"), restated here as the subpath's P5 condition; neither carrier is a
second owner, both name the same predicate.

## Amendment (2026-11-20): the two remaining ui migration records — `open-button` and `open-input`

Append-only record. Owner-approved 2026-11-20 (delegated in-session remediation
authorization; plan §18.7). It adds the migration records the four dated records
above did not carry, in their format: what migrated, the enumerated public-surface
delta, the behaviour that is preserved, and where the evidence lives.

D-18a names `open-button` because it is the docs-site island; `open-input` is
recorded for two reasons: the same class-export retirement landed in the same
migration train (all six `@openelement/ui` components are function components
now, and `registerOpenUi`'s class table is empty), and it is a published subpath
consumed through the workspace-package island path — the ui dogfood fixture
declares `packageIslands: ['@openelement/ui']` and its `/form` page consumes
`open-input`/`open-button`. This record's own rule ("every public delta must be
enumerated") is what makes both records mandatory rather than optional.

## Migration record (2026-11-20): the fifth component, `open-button`

`packages/ui/src/open-button.tsx` is a function component with a sidecar
(`root: 'shadow'`, `delegatesFocus: true`, `formAssociated: true`, the authored
stylesheet, and the six reflected rows `variant` / `size` / `disabled` / `href` /
`target` / `type`). The compiled template is ONE `when` branch (`href !== ''`
picks `<a>`, otherwise `<button>`) with one default slot per branch, so exactly
one control element exists in any state — the earlier two-sibling/hidden-sink
shape assigned the author's text into the hidden anchor's slot (PR #1611 audit).
The click choreography lives in `button-machine.ts` (dispatch order, form
submit/reset, the #757 disabled guard); the shell owns the `:state(disabled)`
fact; `@openelement/ui` no longer exports the `OpenButton` class, the authored
function takes the name, the manifest/CEM declaration becomes generated
(`OpenButtonElement`, no public superclass), the manual registration table drops
the tag, and the interface snapshot is regenerated (class type → function type).

### Public-surface delta (enumerated)

- The `OpenButton` **class export** is retired with the migration: the same name
  is now the authored function component and is not constructible; the element
  constructor exists only in the build output after registration.
- Five readonly computed signals are **retired with the class export**:
  `buttonMode`, `linkHref`, `linkTarget`, `linkRel`, `linkAriaDisabled`. The
  generated lane has no authored getter/computed capability; consumers derive
  those values from the declared `href` / `target` / `disabled` rows (the
  template spells them inline at their JSX position, which is also why they
  refresh).
- The class's private internals sync (`syncInternals` → `syncDisabledState`) is
  retired: the shell seats `authorDisabled || effectiveDisabled` as the host
  custom state and the sheet selects `:host(:state(disabled))`, so the class's
  call was a second writer of that fact.
- Behaviour that is preserved: `open-click` (bubbles, composed; authored in the
  component because the manifest event recognizer scans module-local dispatch
  sites, while the helper owns fire-then-act and the disabled guard), the
  #757/#1061 disabled-anchor href removal, `type` submit/reset through the
  machine (the generated element is form-associated but is not a native submit
  button, so `type` is deliberately not bound on the button branch), reflected
  variant/size styling, `::part(control)`, `delegatesFocus`, and the SSR
  link/button branch (link mode server-serializes a navigable `<a>`).

Evidence: the ui manifest/smoke/contract suites, the www behaviour matrix and
the routes that consume `<open-button>`, the ui dogfood `/form` submit rows, and
the regenerated interface snapshot. LOCAL; the exact consumer-form rows and their
head run belong to the 2026-11-20 evidence re-record and the PR body, not to this
record.

## Migration record (2026-11-20): the sixth component, `open-input`

`packages/ui/src/open-input.tsx` is a function component with a sidecar
(`root: 'shadow'`, `delegatesFocus: true`, `formAssociated: true`, the authored
stylesheet, and the eight declared rows `type` / `placeholder` / `label` /
`name` / `value` / `disabled` / `required` / `error`, where `value` is the live
property the interaction path writes). `input-machine.ts` projects the live
`value` property and the disabled surface; the form contract itself (value
publication, `required → valueMissing`, reset/restore, the fieldset-effective
disabled state) is the shell's M09-2d mapping, not component code. The ids are **static**
(`open-input-control`, `open-input-error`) inside the shadow scope; the class
lane's realm-unique counter existed only to keep SSR and CSR agreeing on a
document-wide identity, which the shadow boundary makes unnecessary — and a
static id is part of the compiled attribute seed instead of a post-claim write.

### Public-surface delta (enumerated)

- The `OpenInput` **class export** is retired with the migration: the same name
  is the authored function component; the element constructor exists only in the
  build output after registration (`OpenInputElement`), the manifest/CEM
  declaration becomes generated, the manual registration table drops the tag,
  and the interface snapshot is regenerated.
- The class's `inputId` property is **retired** (static in-shadow ids replace the
  realm-unique counter).
- Seven readonly computed signals are **retired with the class export**:
  `noLabel`, `noError`, `idAttr`, `errorIdAttr`, `ariaInvalidAttr`,
  `requiredMark`, `describedByAttr`. The label/error/ARIA surface is authored as
  inline JSX expressions so the compiler derives the `label` / `error` row
  dependencies; naming those values in locals would silently make the whole
  error surface SSR-only (16b-migration-note R1).
- The class's private form/state mirroring (`activate`, `updateStates`,
  `syncFormValue`, `syncValidity`, `handleInput`, `handleChange`, `handleFocus`,
  `handleBlur`) is retired: the shell owns the internals record and the form
  contract, and the template owns the interaction handlers.
- Behaviour that is preserved: FormData value publication, `required → valueMissing`,
  value reset/clear and restore, the fieldset-effective disabled state (through
  the shell's `:state(disabled)` channel plus the interaction guard), `delegatesFocus`,
  the four `::part`s (`wrapper` / `label` / `control` / `error`), the label and
  error slots with their ARIA wiring, and the event surface — `open-input`
  (detail `{ value }`), `open-change`, `open-focus`, `open-blur`, all bubbles and
  composed.

Evidence: the www behaviour matrix rows for forms, the ui manifest/smoke
suites, the ui dogfood `/form` page (FormData carries the typed value, required
blocks submission, reset clears, fieldset disabled drops the entry,
`delegatesFocus` + per-input events) and the regenerated interface snapshot.
LOCAL; the exact rows and their head run belong to the 2026-11-20 evidence
re-record and the PR body, not to this record.

## Amendment (2026-11-20): the JSON seed channel — true identity and wire

Append-only fact record. Owner-approved 2026-11-20 (delegated in-session
remediation authorization; plan §18.7). D-18c and the "Implementation plan
record" above stay as written; this amendment records what actually landed and
is the later reading where the two disagree.

### Fail-closed identity

- The channel's own identity is **`OEIR_SHELL_PROP_SEED_MISMATCH`**, raised by the
  shell claim for an unparseable payload, a non-object payload, a row name the
  compiled descriptor does not declare, or a declared row that is not
  JSON-seedable. It is an internal `OEIR_` identity: not a member of the exported
  error catalogue and no public-snapshot change.
- A seed value that does not match its declared row's type fails through the
  existing write guard's identity, **`OEIR_SHELL_PROPERTY_TYPE_MISMATCH`** — so a
  payload can never be written as a value the row's contract rejects.
- D-18c's parenthetical (`OEIR_LEAF_CLAIM_MISMATCH` at "Claim acceptance") is the
  pre-landing wording and stays as history. The claim-mismatch identity keeps the
  DOM/structure and divergent-value facts it already owned; the seed's wire-side
  refusal carries its own code because the cause is a wire fact, not a
  DOM-structure fact.

### Transport and wire

D-18c recorded the exact transport as undecided. The implementation is ONE
shell-owned host attribute, **`data-oe-prop-seed`**, carrying a JSON object
`{"<rowName>": <json value>, …}` — written by the emitted host producer (the
serializer's seed fold) from supplied non-primitive rows and read/consumed once
by the shell claim BEFORE the recipe runs. One attribute rather than one per row,
because a per-row attribute would invent a dialect the client's
`observedAttributes` never observes.

Wire contract, including the known debt:

- **No version marker, no self-describing header.** The payload is a bare JSON
  object whose names are validated against the compiled descriptor. A future
  change to the payload grammar must add an explicit format version rather than
  reinterpret an old payload; today "format version 1" is the implicit contract,
  and the absent marker is recorded here as **known debt**, not as a promise.
- **Consume-once.** The shell removes the attribute on read, so a second claim
  never re-applies a stale value over a user write.
- **Admitted rows only.** Declared `array`/`object` rows; `trustedHtml` stays
  structurally excluded (a brand cannot be reconstructed from JSON, and promoting
  a plain string back to it would be a raw-markup channel — D-18c's separate
  decision).
- **Inert when there is no seedable row.** A descriptor with no JSON-seedable row
  never reads the attribute (the shell's connect path is contractually
  attribute-read-free unless a declared row needs a wire), so an attribute
  present on such an element is inert rather than diagnosed.
- **Equal seed writes nothing.** The value write is guarded by identity, so a
  seed equal to the current value mutates nothing; a structurally divergent
  payload fails closed as above rather than silently keeping the default.
- **Trust class.** A seeded value is the same trust class as a direct property
  write: a payload name is only ever matched against the compiled descriptor's
  declared row names (an unknown name fails closed), and the admitted value is
  assigned as that row's value rather than merged into a target object — so no
  key in the payload reaches an assignment sink, no raw-markup channel is added,
  and the shell does not deep-filter `__proto__`/`constructor` names inside an
  admitted value. The hostile-payload negative and any deep-key policy remain
  **OWED evidence rows** of the seed suite (named in the 2026-11-20 evidence
  re-record), not closed by this amendment.

## Amendment (2026-11-20): correction to Correction 3 — the dropdown focus-return wiring is element-lifetime, not connection-signal scoped

Append-only factual correction. Owner-approved 2026-11-20 (delegated in-session
remediation authorization; plan §18.7). The 2026-11-17 "Correction 3" section
above stays as written; its sentence "It now records its three listeners, drops
them on the connection signal's abort and again at element-lifetime teardown
(idempotent)" is superseded by this reading.

The implemented mechanism (`packages/ui/src/dropdown-machine.ts`,
`packages/ui/src/open-dropdown.tsx`):

- `env.signal` is the **element-lifetime** channel (aborted on a failed connect
  pass and at element teardown), not a per-connection signal. It cannot bound a
  per-connection listener set: a reconnect would find the wiring disposed while
  the compiled nodes were re-claimed. `watchDropdownFocusReturn` therefore
  receives the optional signal and deliberately ignores it (`void signal`), and
  the component calls `activateDropdown(host)` without passing `env.signal`.
- The wiring is once per host on the **retained shadow root**, but it IS
  re-established per connection: each `activateDropdown` first tears down the
  previous generation's wiring and bumps a `connectionGeneration` gate, then
  wires fresh listeners. A queued `toggle` task that outlived its connection is
  a no-op through that gate, and the queued focus-restore microtask refuses to
  move focus when the host is no longer connected.
- Teardown is at **element lifetime**: `onDispose` calls
  `disposeDropdownFocusWiring(host)` (idempotent, also called by the next
  activation).

The functional guarantees Correction 3 claimed are preserved: no listener of this
module survives teardown, a dead connection makes no focus decision, and a
reconnect ends with exactly one wired listener set. What changes is the mechanism
and the scope of `env.signal` — the connection bookkeeping is the
`connectionGeneration` gate plus the activation-time dispose, not the signal's
abort. The three JSDoc paragraphs in `dropdown-machine.ts` that still describe the
connection-scoped form are the companion correction this remediation records as
required (an ADR is append-only, so they cannot be corrected here); this record
is the authoritative statement of the semantics.

## Amendment (2026-11-20): `useHost` is FUTURE/OWED

Append-only status record. Owner-approved 2026-11-20 (delegated in-session
remediation authorization; plan §18.7).

D-18b item 4 lists `useHost` as part of the experience edition. It is **not
implemented** and is recorded as **FUTURE/OWED** (Alpha17 or later): there is no
export on `./lifecycle` or the root surface, no compiler recognition, no snapshot
symbol and no consumer evidence. The delivered host-access channel of this
edition is `env.host` on the lifecycle, change and error callbacks (the owning
generated element for a root; the nearest ancestor generated element host for a
depth-1 retained hostless child). `useHost` is **not** counted in the delivered
experience-edition surface, this ADR creates no implementation obligation for it,
and if it lands it needs its own public-delta record and P7 review.

## Amendment (2026-11-20): `provideContext` — an accepted same-name, different-meaning surface

Append-only decision record. Owner-approved 2026-11-20 (delegated in-session
remediation authorization; plan §18.7). It changes no export and adds no
diagnostic.

Two different functions carry the name `provideContext` in this package:

- **Root surface (host-side).** `provideContext(host, context, value)` — the
  class-lane/tree primitive that provides a value on a host element and returns
  an unsubscribe handle (`packages/element/src/internal/core/signal-context.ts`,
  re-exported by `packages/element/src/public-surface.ts`).
- **`./lifecycle` surface (generated lane).** `provideContext(context, read)` —
  the compiler-erased provider intrinsic admitted by binding provenance from a
  named import of `@openelement/element` or `@openelement/element/lifecycle`;
  the thunk is re-read on connect and after every declared-row commit
  (`packages/element/src/internal/core/compile-lifecycle.ts`).

**Decision: keep both, recorded as an accepted ambiguity.** Renaming either
would add another public-surface delta to this change; a compiler diagnostic
would have to guess intent, because binding provenance already separates the two
call shapes. **Authoring guidance:** inside a generated (function) component,
import `provideContext` from `@openelement/element/lifecycle`; the root export is
the host-side helper. The root module deliberately does not re-export the
intrinsic, and `packages/element/src/public-surface.ts` already carries this
guidance to readers; this amendment is the owner-facing record of the same
decision (the code-side JSDoc carries the pointer).

## Amendment (2026-11-20): `16b-EB` delivery truth — two capture points, SSR fallback deferred

Append-only fact record. Owner-approved 2026-11-20 (delegated in-session
remediation authorization; plan §18.7). It records what the `16b-EB` slice
actually delivered and matches the §13.2 obligation change recorded in
execution-plan §18.3.

- **Delivered:** the author-facing error boundary (`onError`) with **two** capture
  points — (1) the connect/claim pass, where the shell's `connectedCallback` catch
  already covered mount, claim, setup and the `onConnect` replay as one instance
  pass, and (2) the update phase, through the generated `guardUpdate(fn, sink)`
  channel for refresh subscriptions and DOM listeners. The shell owns the handler
  list and both capture points (`packages/element/src/internal/compiled/generated-element/shell.ts`).
  The callback receives `{ host, signal, states, error }`; with no registered
  handler both capture points keep the pre-`16b-EB` rethrow/rollback behaviour
  (no silent swallow); a handler that throws replaces the original error; the
  handler list is cleared wherever the change list is cleared, so no handler runs
  after its owner is gone; an async rejection is deliberately not a capture point
  (no scheduler, no global rejection listener, and not attributable to one
  element). Both channels are compiler-private runtime properties on the host
  records the compiler already builds — no exported symbol or type is added.
- **Not delivered:** an SSR fallback. Execution-plan §18.3 amends the §13.2
  `16b-EB` minimum obligation accordingly and defers the SSR fallback to
  **Alpha17** as a named carry (with the carry's delivery conditions listed
  there). That is a plan obligation change, **not** a §13.3 scope exception.
- The boundary reset policy remains OPEN (D-18b) and no author-facing reset API
  is part of the delivery; the capability inventory's `16b-EB` row and the
  `16b-MN` `16b-EB` section are corrected to this truth by the 2026-11-20
  remediation (capture points only; no SSR fallback; the Alpha17 carry).

## Amendment (2026-11-20): the client-JS SLO — 344 → 376 → 408 KiB ratified

Append-only decision record. Owner-approved 2026-11-20 (delegated in-session
remediation authorization; plan §18.7; the full decision record is
execution-plan §18.4 and the measurement notes live in `www/site-budget.ts`).

The sentence in the 2026-11-17 "light-root SSR producer row (B4)" amendment —
"they exceed the www client-JS budget (352.8 KB vs the 344 KB SLO)" and "the
island migrations themselves are NOT landed" — is history: it was written before
the two owner-approved raises and before the islands landed. The SLO is now
`totalJsKB: 408` (`islandKB: 84` unchanged): 344 → 376 on 2026-11-17 (first two
migrated generated islands; ~6% headroom) and 376 → 408 on 2026-11-18 (the
`open-search` migration; ~4.4% headroom over the measured 390.0 KiB). Both raises
are owner-approved — the first already carried the "(owner decision)" label, the
second is ratified by the 2026-11-20 delegated approval. The next re-measure point
is the P1 end state (every island migrated, the executor leaves the shared
chunk); 408 is not permanent slack and lowering it remains the only way to
tighten the SLO.

## Status update (2026-11-20): D-18c's seed is landed at `17cd3cd57`

The "Implementation plan record (2026-11-17)" above ends with "Why it is not
landed yet". That paragraph is the pre-landing state and stays as history; the
channel landed at commit `17cd3cd57` ("feat(element): ship the non-primitive JSON
seed channel (D-18c / M11-3)"), an ancestor of this PR's head. The shipped wire,
its identity and its known debt are recorded in the 2026-11-20 seed amendment
above; the §17.3 acceptance-evidence row for D-17c is owned by the 2026-11-20
evidence re-record and the PR body, not by this note.

## Evidence re-recorded (2026-11-20)

Append-only evidence section. It records the 2026-11-20 head re-record for the
delivery-line claims this record carries; it rewrites no earlier evidence
paragraph and creates no milestone, gate, exit or release claim. The measured
commit is `f514c1290539993f9bdbeca9b02b6f99ca0a4dff`. The later commit
`434a624d39496eed70d29df4c1bba3fef17cca56` changes only one JSON annotation and
one test comment; it neither changes behavior nor is re-measured.

**Five-field record.** commit: `f514c1290539993f9bdbeca9b02b6f99ca0a4dff`
(HEAD did not move across the run). status: clean at measurement —
`git status --porcelain` showed only the pre-existing
`?? .cc-agent-transcript.jsonl`; every artifact used is Git-ignored. provenance:
`LOCAL` — a clean worktree at the cited commit; a LOCAL record only,
not a CI run/job, and no CI column is written. commands and results: per row
below. Full log:
`.artifacts/pr1804-remediation-20261120/02-evidence/EVIDENCE-RUN.md`.

| claim | command → result at the measured commit |
| --- | --- |
| P1 — the generic executor is unreachable from the production browser entry graph | `./node_modules/.bin/vp run --no-cache --fail-if-no-match site:build` (exit 0, `gate ok: 6 step(s)`, 30 s) → `node tools/repo/check-browser-entry-graph.ts www/dist/client/.vite/oe-browser-entry-graph.json`: `1 artifact(s) — 1 MET, 0 VIOLATED, 0 UNPROVEN; verdict: MET`; `loadedModuleCount` 135, 13 chunks, 8 islands, `0/6` executor entries; runtime chunk 41 module-table entries (40 workspace + 1 `node_modules/@preact/signals-core`) |
| P2 — the server reads the new structure | the `find`/`grep` count block → 78 HTML files, **78/78** carry a generated host; host counts `open-page-rail` 68 / `open-search` 78 / `open-theme-toggle` 78 / `open-code-block` 278 / `open-button` 18; `data-oe-prop-seed` 68 pages / 68 occurrences; `items="[object Object]"` 0 pages. (The "through the compiler-emitted producer" attribution is advisory in the re-record — counts only were recomputed) |
| P3 — build/SSG facts rather than a source-text read | `grep -rn '@element(' packages/router/src` → **10 hits**: diagnostic messages, doc comments, and one generator (`vite/plugin-mdx-lower.ts:204` EMITS an `@element(...)` template literal; no control flow reads a source marker) |
| P4 — no `__partProgram` in the production payload | `grep` over `www/dist/client` → files 0 / occurrences 0; over `www/dist/**/*.html` → **2 files / 6 occurrences, all API-reference prose (en+zh reference pages)** |
| P5 — retired exports, migration note and inventory tracked | `./node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/tools-repo interface:snapshot` → `Public interface snapshot matches (6 packages).` (exit 0, 21 s); the retired-export census and the migration-note rows were not re-censused (advisory for a fresh census) |
| M12 — packed-consumer recorded evidence | `./node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/tools-release pack:dry-run` (exit 0, 46 s) then `./node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/tools-release consumer:packaged-element` → **9 PASS / 0 FAIL**, 19 s; HEAD tarballs element 218917 B / compiler 199674 B / protocol 54634 B; packed S3 generated module 228924 B; engines chromium 147.0.7727.15 / firefox 148.0.2 / webkit 26.4. **Recorded evidence, not a declared exit** (one app, one island; the harness's own scope limits stand) |
| M13 — site-side three-engine recorded evidence | `./node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/www e2e:browsers` → **1092 passed (expected 1090 + 2 flaky), 0 failed, 2 flaky retry-cleared, 26.0 min**, exit 0; per project chromium 368 / 0 / 0 / 0 flaky, firefox 361 / 0 / 0 / 2 flaky, webkit 363 / 0 / 0 / 0; engines chromium 147.0.7727.15 / firefox 148.0.2 / webkit 26.4; the two flaky identities are recorded (firefox `/reference/` axe engine timeout; firefox theme-toggle expected `light` received `dark`). **Recorded evidence, not a declared exit** — the exact-SHA dispatch record and the server matrix remain the plan §18.6 follow-up |

Per-row records live in [the P1 applicability record](../architecture/p1-applicability-record.md)
(section `FINAL VERDICTS — re-recorded 2026-11-20 at f514c1290539993f9bdbeca9b02b6f99ca0a4dff`),
the [progress ledger](../architecture/alpha16-18-progress.md) M10–M13 rows and the
[capability inventory](../architecture/alpha16-capability-inventory.md) section
`Final-SHA matrix (2026-11-20)`. This section is the ADR-layer pointer to those
records, not a second copy of the numbers, and nothing here is an exit or a
release qualification.

**Historical "LOCAL." evidence paragraphs.** The migration records and the B4/B9
amendments earlier in this file state "LOCAL." with per-run counts and carry no
commit/status/command/provenance record of their own; those counts are that
head's local values. They **stay historical (advisory only)** and are not
upgraded by this section. The delivery-line evidence for the same claims is this
section and the per-row records it cites; where the two readings disagree, this
section's re-recorded values and the cited row records are the later reading.

## Amendment (2026-11-20): `useHost` is IMPLEMENTED in Alpha16b

Append-only status record. Supersedes the amendment above ("`useHost` is
FUTURE/OWED") without rewriting it — that text stays as the historical reading.

Owner direction (execution-plan §19, `16b-REF`) moved `useHost` from FUTURE into
Alpha16b. It is now delivered, and this record states exactly what was built so
the delivery claim has a written shape.

**What it is.** `useHost()` returns the OWNING ELEMENT as a value — the same fact
the lifecycle / change / error callbacks already receive as `env.host`: the
generated element for a root, the nearest enclosing generated element host for a
depth-1 retained hostless child. It is a **compiler-erased intrinsic**, admitted
by binding provenance (a named import of `useHost` from `@openelement/element` or
`@openelement/element/lifecycle`), exactly like `ref` and `useContext`.

**What it is not.** Not a runtime channel and not a second host lookup: the
retained setup factory already receives the element on its host record
(`__oe_hostElement`), so the lowering is ONE field read. It allocates nothing, so
it needs no lifetime and no cleanup; and the element identity never changes for an
instance, so it needs no reactivity — a derived node capturing it cannot go stale.

**Refusals (fail closed, existing `OEC9042` form code):** arguments, type
arguments, and a reassignable (`let`/`var`) binding. A local function that happens
to be named `useHost` is not the intrinsic and keeps the ordinary grammar.

**Server side.** The server has no bindings channel and no element (ADR-0181), so
a component whose *rendered output* depends on the host element is not
server-renderable. That is a loud, named failure (`OEIR_LEAF_MISSING_VALUE:
host`), never a silently empty slot — pinned by a test row.

**Public delta:** `useHost` is added to the root entry and to the
`./lifecycle` subpath. The regenerated public-interface snapshot carries exactly
two additions (`useHost=value:{call:()=>HTMLElement}` on `.` and `./base`) plus
the derived shape hash; no other symbol changed.

**P5 retirement condition.** The intrinsic retires if the compiler ever gains a
general author-visible element accessor with the same fact (e.g. a framework-level
`this`); it would then be replaced by that spelling rather than kept as a second
one. Recorded here so a later reader removes it deliberately.

Superseded count: ADR-0182's "not counted in the delivered experience-edition
surface" line no longer applies to `useHost`; `16b-MN` and the capability
inventory must read this amendment as the later status.

## Amendment (2026-11-20): `trustedHtml` and non-JSON seeds — PERMANENT exclusion

Append-only status record. Owner-approved 2026-11-20 (delegated in-session
remediation authorization; execution-plan §19.4). This is the dated amendment
§19.4 requires, and it settles the question rather than deferring it.

**The decision.** No server→client channel is built for a `trustedHtml` value, and
none for a property value that is not JSON-encodable. This is a **permanent
exclusion** — not an Alpha17 carry, and **not** a §13.3/§14.1 exception that a
later slice may lift.

**Why it is permanent, in two sentences.** The `trustedHtml` brand is `WeakSet`
object identity: a byte stream on the wire cannot reconstruct it, so any transport
would either drop the brand (a raw-markup channel — refused on principle) or
invent a second brand-issuing constructor (a second trust root). A non-JSON value
has no faithful wire form at all, and a lossy one would make the claimed state
quietly differ from the server's — which is the exact divergence D-18c exists to
prevent.

**What the code already does (measured, not aspirational).**

| site | behaviour |
| --- | --- |
| `generated-element/shell.ts:541-554` | a supplied property-only row that fails `JSON.stringify` (or serializes to `undefined`) throws `OEIR_LEAF_UNSEEDABLE_PROPERTY` with the JSON reason — it never silently degrades to the declared default |
| `generated-element/shell.ts:340-348` | the seeder's contract names the exclusion: `trustedHtml` stays out because a brand cannot be reconstructed from JSON and promoting a plain string back to it would be a raw-markup channel |
| `generated-prop-seed-hardening.test.ts:59-70` | the row set carries a real `trustedHtml` row as an excluded-row CONTROL, so the test fails if a later change starts seeding it |
| `generated-prop-seed-hardening.test.ts:309-330` | the cyclic-array and `undefined`-serializing rows pin the two refusal shapes |

**What stays, and what does not.** The property-only, in-process value model stays:
a `trustedHtml` row is still declarable, still defaults, and still renders — the
exclusion is about the server→client CROSSING, not about the value's existence.
`§14.2`'s retained `array/object/trustedHtml` row is read with this exclusion.

**The in-tree consumer that motivated it.** `open-article-view`'s article body was
the component that made the question concrete. It is handled by the owner-directed
build-time structured body (class-migration matrix D-M5): the body stops being a
runtime string crossing and becomes a build-time fact. **That design is owed as
its own amendment before any file claims it**, and this record does not
pre-approve it — it only removes the "we could just seed it" alternative from the
table permanently.

**P5 note.** A permanent exclusion adds no capability to inventory and retires
nothing; it must still be listed in the closeout's exclusion section so a reader
does not mistake absence for an unfinished item.

## Amendment (2026-11-20, later): the `16b-EB` SSR fallback is NOT an Alpha17 carry — condition 1 delivered

Append-only fact record. Owner-approved 2026-11-20 (delegated in-session
remediation authorization; plan §18.7). **It supersedes the "Not delivered: an SSR
fallback … defers the SSR fallback to Alpha17" half of the amendment above**, by the
owner's reversal recorded in execution plan §19.2:

> the owner reversed that deferral on 2026-11-20: the SSR fallback is implemented
> **inside Alpha16b**. The deferred status and the §13.2-preamble supersession are
> history.

The earlier amendment stays as written — it is an append-only record of the
2026-11-20 state of knowledge — but a reader must not take its Alpha17 carry as
current. This is exactly the two-faces-one-fact drift the design constitution
forbids, corrected at its source rather than left for a reader to reconcile.

### Condition 1 of §19.2 — DELIVERED

The contract, as implemented:

| question | answer |
| --- | --- |
| Bytes a failing descendant contributes | the **enclosing boundary's fallback** — the caller's own literal markup for that host, passed through unchanged |
| How the failure stays observable | it is **carried out** to the render's `onNestedFailure` report channel — never swallowed |
| No boundary on the render | the **original error propagates** and the whole render fails — byte-identical to pre-`16b-EB` |

Seat: `nestedHost`'s expansion call (`packages/element/src/internal/compiled/runtime/nested-host.ts`).
The failing phase IS the descendant's producer and the enclosing frame that catches
it is the boundary's, so it is the only place that both knows the failure and can
still emit fallback bytes; it is also already the ONE call every generated producer
makes per dash tag, so the fallback needed no second dispatcher.

**The rejected shape, recorded because it is instructive.** The first attempt put a
reporter on the producer's host record and widened its third argument to
`{ nestedHost, reporter }`. It type-checked and its unit rows passed — then
`site:build` produced **0 DSD templates** on the docs page and the A6
unreferenced-sheet row went red: the wrapper's host record is a single-argument
ABI the shell builds, and widening it silently broke nested expansion for every
host. Reverted and re-seated on the catch, which touches nothing the producer sees.
A runtime ABI that "looks internal" is still an ABI when the emitted code is the
caller.

The one public-surface consequence: `RenderToStringOptions` gained
`onNestedFailure?: (error: unknown) => void`, the **only** addition this release
line made to the public API, and it is recorded in
`docs/release/public-interface-snapshot.json`.

### Condition 2 — DELIVERED (`generated-nested-fallback.test.ts`)

The render path emits the boundary's fallback bytes for a failing descendant, and
the failure is carried out rather than swallowed. Pinned in **consumer form**: a
real `renderToString` pass over a light-root class carrying the compiler-emitted
`__ssr` producer — the one root shape whose render installs the nested expander —
whose nested generated producer throws.

Four properties, all asserted: (1) the failing descendant contributes the CALLER's
literal bytes so the render still returns markup; (2) the failure reaches
`onNestedFailure` exactly once with the real error; (3) with NO report channel the
original error propagates, which is the no-silent-swallow guarantee; (4) a healthy
SIBLING producer in the same render still expands to its DSD.

**Why the harness matters more than usual here.** The first three drafts of this
suite passed nothing: one emitted the dash tags literally (never calling
`nestedHost`, so nothing could fail), one registered the page through the
generated-host-renderer channel (which does not install the expander), and one
wrapped the expander by hand in a way the shell does not. Only the shape that
matches what the light path actually does — a class with `__ssr`, expander as the
third argument — could observe the fallback. That is precisely why condition 1's
own rows were not sufficient: they call the helper directly, so they cannot see
whether the RENDER wires it.

### Conditions 3–4

- **3** — the one-SHA consumer-form bundle is assembled from condition 2's row plus
  the two unchanged Alpha16 capture points;
- **3** — the one-SHA consumer-form evidence bundle (fallback bytes for a failing
  producer, claim parity over them, the no-silent-swallow row, and the two Alpha16
  capture points unchanged);
- **4** — the row-for-row status move in the `16b-MN` record, the capability
  inventory and this ADR. This amendment performs the ADR half; the inventory and
  `16b-MN` rows move with it and both name condition 1 as delivered and 2–4 as open.

**`16b-EB` is therefore still NOT a delivered capability.** The capture points
(unchanged) plus condition 1 are delivered; the row cannot flip until all four hold.
