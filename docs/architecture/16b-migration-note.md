---
status: active
topic: Alpha16b migration note (16b-MN)
summary: The tracked carrier for the row-for-row 16b-MN obligations. It records what must migrate and what remains open; it is not the P5 capability inventory and creates no release evidence.
---

# 16b-MN — Alpha16 migration note (tracked carrier)

Date: 2026-11-14. Baseline: `origin/main` =
`fa6e5232dd54520d100108b202a73a1d70341f11` (PR #1790, M09-2d).

Working-tree additions on 2026-11-15 (the Alpha16b capability train) are
authorized by [ADR-0180](../adr/ADR-0180-function-component-lifecycle-intrinsics.md)
and [ADR-0181](../adr/ADR-0181-generated-element-ssr-and-retention.md), and
registered in [execution plan §16](./alpha16-18-execution-plan.md). Evidence for
them lives in the [2026-11-15 appendix](./alpha16b-evidence-20261115.md). No row
below is closed by that train; each keeps the state it records.

## Status and scope

`alpha16-18-execution-plan.md` §13.2 names five Alpha16b obligation slices
(`16b-LC`, `16b-EB`, `16b-CTX`, `16b-REF`, `16b-MN`). Before this change all five
were labels inside the plan only: no in-tree file, ledger row, named owner or
gate. This document is the **tracked carrier of `16b-MN`** — the minimum
migration guide that §13.2:395 requires to ship with Alpha16. It introduces no
new slice and no new milestone (§14.4:525-527).

**This document is not the P5 capability inventory.** §13.5:445-451 requires a
tracked capability inventory, a final-SHA matrix, `16b-MN` and the owner
sign-off; "A draft does not satisfy P5 … until then, P5 is not claimable and
Alpha16 release qualification is not openable". The untracked working draft
`alpha16-migration-capabilities.md` is none of those. **No owner sign-off is
recorded here and no gate was run.** Every row below is OPEN. An amendment of
2026-11-15 records the CEM input fixture-first slice in the verification
appendix; no row flips to closed and no milestone or P5 claim changes. A second
2026-11-15 amendment records `16b-LC` as PARTIAL (root lifecycle delivered;
nested/hostless hooks and connection-scope helpers OWED) and the generated-island
style channel as PARTIAL (declaration and build pipeline delivered for light
roots; document application and shadow adoption carried by GH issue #1800 /
M09-2e); no row flips to closed and no sign-off is recorded.

## Row-for-row obligations (§14.1 condition 6, §14.2:504)

| Capability | Corrected record | Carried by | Current state | Evidence still owed |
| --- | --- | --- | --- | --- |
| `custom-elements.json` (CEM) generation for generated elements | retained obligation (was: §13.3 exception) | M09 platform surface; M10 P3/P5; M12 packed qualification | **OPEN — fixture-first bounded mechanism only.** D-② phase 1 lands the input path: `packages/ui/tools/generated-element-facts.ts` runs the real generated-element lane on a fixture module, reads the emitted constructor identity from the emitted module's own export table (never the author function name), and projects the lane's resolved descriptor rows, JSX slot/part names and authored JSDoc summary into the internal manifest; `packages/ui/tools/generate-ui-manifest.ts` gains an injectable fixture root plus host site-fact dispatch, and `packages/ui/tools/generate-cem.ts` gains an in-memory projection entry that validates the result against the official CEM 2.1.0 schema (attributes/slots/cssParts preserved; no fabricated superclass or events). The tracked `packages/ui/src/generated-manifest.json` and `packages/ui/custom-elements.json` stay byte-identical — the live `packages/ui/src` tag source is not wired, so no shipped build or packed artifact declares a generated element. `m09-2b-primitive-properties.md`:348-352 "No CEM output" remains true of the shipped class-lane build, and the phase-1 implementation is uncommitted at the `0b07e7ecb` baseline with no PR or gate record. | live-input (`packages/ui/src`) generated CEM structure test; packed `@openelement/ui` metadata read back by the CEM scanner; `gate:release` and `gate:packed` green at the same SHA; the fixture-first runs are LOCAL dev feedback at dirty baseline `0b07e7ecb`, not clean-SHA evidence. The alternative owner-approved migration of the packed CEM artifact contract is recorded in the M09 exit docket (D-2, PR #1793). |
| array/object/`trustedHtml` property conversion | retained obligation (was: §13.3 exception) | M09 property/attribute conversion; M10 P5 | **OPEN — bounded mechanism only.** #1789 `f69dde8bf` lands property-only channels; the slice document self-describes "bounded implemented — LOCAL review pending", no server→client seed, "not the M09 exit". Its Chromium vertical and Node contract pass at `237e14bd2` (see the Verification appendix); the consumer round-trip tests remain outstanding. | property round-trip tests for the in-tree consumers (`notes-live`, `open-article-view`, `open-reading-shell`); packed ui-app/site build; the TSX rows that carry those components. |
| form validity policy (`setValidity` rules) | retained obligation (was: §13.3 exception) | M09 forms; M10 P5; `16b-MN` | **OPEN — bounded mechanism only.** #1790 `fa6e5232d` lands `formAssociated`, value / required / disabled and `required → valueMissing`; the slice document declares an explicit "Host access gap" non-claim, "not full OpenInput migration parity", Chromium LOCAL only. Its Chromium vertical and Node contract pass at `237e14bd2` (see the Verification appendix). | the existing form e2e contract re-run on the generated CE; form value / reset / restore tests on the generated path. Full constraint mirroring (type/email, minlength, …) may stay a **deferred sub-obligation listed in this row**, never an exception (§14.2:510). |
| Two `/internal/*` artifact-resolution export subpaths | named deviation, no exemption | ADR-0137 §1 remains in force; ADR-0177 owns the written retirement condition | **OPEN — deviation registered 2026-11-14**; `packages/element/package.json`:16-17 unchanged. | `graph:check` zero importers outside `packages/element`; `esm:boundary-check` no external resolution; snapshot zero `publicSymbols`; `gate:release` + `gate:packed` green at one SHA. Byte attribution in the full reachable page closure also remains owed (ADR-0174:42-50, :12-13). |

Before the 2026-11-15 amendments, none of the five `16b-*` slices had an
implementation slice. `16b-LC` (lifecycle) is now **PARTIAL**: the
generated-element ROOT author lifecycle hooks are delivered, while nested/hostless
hooks and the connection-scope helper channel are OWED (see the amendment
below). `16b-EB` (error boundary), `16b-CTX` (context, TSX-13) and `16b-REF`
(refs) still have no implementation slice and must be delivered inside Alpha16b;
they may not be deferred to Alpha17 (§13.2:385-387). None of them is claimed
here.

## Two non-exception items, unchanged (§13.3:427-435)

- Client style declaration for generated islands remains a **deferred
  obligation**, not an exception (a replacement path exists); M11 re-verifies it
  on a real build. The 2026-11-15 amendment below records the channel as
  PARTIAL: declaration plus the existing build pipeline are delivered for
  light-root generated islands, while document application and shadow adoption
  are carried by GH issue #1800 / M09-2e.
- Utility and theme CSS is outside the capability list entirely (build-side, no
  authoring model dependency); M11 re-verifies it.

## 2026-11-15 amendment — 16b-LC and the generated-island style channel are PARTIAL (working tree)

Status: **working-tree amendment — uncommitted, not a status flip, not a
capability-inventory row, no sign-off, no gate.** Date: 2026-11-15
(Asia/Shanghai). Base: `feat/alpha16-integration` @ `6bd3667d4`, plus the
uncommitted `16b-LC` lifecycle and generated-island style lanes (the tree also
carries other lanes' edits). This amendment records two PARTIAL states; no row
above flips to closed and no milestone, P5 or release claim changes. It is not
clean-SHA evidence.

### 16b-LC — PARTIAL: root author lifecycle delivered, the rest OWED

The generated-element lane now admits author `onConnect` / `onDispose` as
compiler-erased intrinsics in the generated element ROOT setup only (binding
provenance: a named import of `@openelement/element`, aliases followed; direct
top-level statements). The lowered callbacks ride the retained
`__oe_rootInstance` record; `onConnect` replays on the per-connection scope in
the mount/claim prologue with its optional cleanup registered there, and
`onDispose` registers on the element-lifetime instance owner. The intrinsics are
erased from the emitted module and fail closed with the existing
`JSX_OUTSIDE_COMPILER` identity outside the compiler; the emitted SSR producer
runs no hook. The seam is registered in the
[M09-0 shell record](./m09-generated-element-shell.md) and in
[`seams.md`](./seams.md).

Owed, and the reason this is PARTIAL, not delivered:

- nested/hostless component hooks — they keep the unchanged `OEC9041` statement
  refusal — and any cross-component reconciliation;
- the connection-scope helper channel (callback parameters) — a hook callback
  with a parameter is refused today, so there is no connection-scope context
  and no setup-once author API;
- the timing semantics an author may expect from "connected": the replay runs
  in the mount/claim prologue before the connection's DOM exists, so this record
  claims no ADR-0173 DOM/refs-ready timing;
- signal reads inside a hook remain a host-binding read and are refused by the
  unchanged `UNBOUND_BINDING` gate.

### Generated-island style channel — PARTIAL: declaration and build pipeline delivered, application OWED

`IslandConfig.styles` is now declared and validated on a LIGHT-root
generated-element (function) island and carried through the build into the SAME
router style plan the class lane uses: one specifier rule shared by the runtime
authoring face and the static island scan, a build-time declaration carrier,
registration into the existing compiler style-edge registry, one
content-addressed `.css` asset and the client asset manifest `styles` record.
There is no second style pipeline, hash or emitter. The seam is registered in
[`seams.md`](./seams.md).

Owed, and the reason this is PARTIAL, not delivered:

- document-level application of the emitted sheet on a light root (the class
  lane's head `<link>` is not wired to the generated-element render path);
- shadow-root adoption: no DSD style-link carrier until M09-2e, so a shadow-root
  declaration is refused at build with the coded
  `OE_ISLAND_STYLE_SHADOW_UNWIRED` diagnostic instead of being silently lost;
- a non-generated/class-lane module declaring `styles` is refused with
  `OE_ISLAND_STYLE_LANE_UNSUPPORTED`; its sheets belong to `static styles`.

The adoption surface is carried by GH issue #1800 (Alpha17) and the shadow
carrier by M09-2e; M11 still re-verifies the deferred client style declaration
obligation on a real build. The two lanes' test files are untracked in this
working tree and their LOCAL results are dirty-tree development feedback, not
clean-SHA evidence.

### What this amendment does not do

- It flips no row to closed, records no capability-inventory row, no final-SHA
  matrix, no gate result, no clean-SHA evidence and no sign-off.
- It does not claim `16b-LC`, `16b-LC retained-child`, §4.1d, M09 exit, M13 or any Alpha16
  exit / P5 item.
- It does not rewrite the execution plan, the progress ledger, the semantic test
  matrix, the public-interface snapshot or any `packages/*` source/export map.

## Retirement-condition form (P5 / P6 / P8)

Every shim, drift guard and derived pointer must carry a condition of the form:

```
RETIRE <object> WHEN <existing gate reports a recomputable predicate on a standard artifact> ;
VERIFY <gate> WITH gate:release AND gate:packed GREEN AT <one SHA> ;
RECORD <16b-MN row / shim-inventory detail / seams guard / package.json "//"> ;
OWNER <single owner>
```

The condition is an event, never a date or "next review". Its source is a standard
artifact (module graph, type checker, Playwright report, packed tarball,
`public-interface-snapshot.json`) — see `shim-inventory.md`:366-370 and
`tools/repo/check-shims.ts`:416-421. The compliant precedents are
`ADR-0155`:175-205 and `ADR-0166`:134-148. Explicitly forbidden as conditions:
"Re-verify at each audit. No action." (`alpha16-18-progress.md`:442), a
procedural "needs its own PR" (`:440`), or a reference to a removed document
(execution-plan §2:111-116, §12a:351 — see §15.1 of the execution plan for the
later reading).

## Verification appendix (LOCAL, advisory — not exit evidence)

A read-only check of the two bounded M09-2d slices on the Gate A commit, recorded
in the five-field form of `docs/architecture/evidence-baseline.md` §Evidence
authority. It is **not** a milestone exit, a gate record, a browser qualification
(M13), a P5 evidence item or a release claim.

| Field | Record |
| --- | --- |
| commit | `237e14bd2a3330618882af5ef02bfdf698c65eca` |
| status | `git status --porcelain` empty (clean worktree) at that commit |
| command | `node_modules/.bin/vitest run --project compiler packages/compiler/__tests__/semantic-ir/generated-element.nonprimitive-properties.browser.test.ts packages/compiler/__tests__/semantic-ir/generated-element.forms.browser.test.ts packages/compiler/__tests__/semantic-ir/generated-element.forms.test.ts packages/compiler/__tests__/semantic-ir/generated-element.nonprimitive-properties.test.ts` (Node v24.18.0) |
| result | 4 files / 53 tests passed — browser 9/9 (non-primitive), 10/10 (forms); Node 28/28 (non-primitive), 6/6 (forms); no failures, no skips |
| provenance | `LOCAL .artifacts/alpha16-restart-20261114/worktree`, chromium only; no CI run/job identity, no Firefox/WebKit, and the engine revision was not recorded — one reason this stays advisory |

This resolves one factual question carried into the discussion: the #1789
Chromium vertical **is green at the current tip**. It does not resolve the
"LOCAL review pending" notes in #1789 / #1790, the CEM retained
obligation, the in-tree consumer round-trip tests, the full reachable page
closure byte attribution (ADR-0174:12-13), or any M09 exit. §13.5 stays in
force: P5 is not claimable and Alpha16 release qualification is not openable.

### CEM input fixture-first (D-② phase 1) — LOCAL, advisory

A second five-field record, kept separate from the Gate A row above because it
was taken on the dirty 2026-11-15 working tree. It records the fixture-first
input slice only: a real function-component fixture root reaches the internal
manifest and a schema-valid CEM class in memory. It is not a §13.6 record, a
gate record, packed-artifact evidence or any M09 exit / M10 / P5 item.

| Field | Record |
| --- | --- |
| commit | `0b07e7ecbe7dd797b88c858c530a000448f7b984` (`main` HEAD at the run) |
| status | dirty — the slice's own files and other lanes' uncommitted work are present; not a clean worktree |
| command | `node_modules/.bin/vitest run --root . --project ui packages/ui/tools/generated-element-facts.test.ts packages/ui/tools/generate-ui-manifest.generated-element.test.ts packages/ui/tools/generate-cem.fixture.test.ts` (Node v24.18.0); `node packages/ui/tools/generate-ui-manifest.ts --check`; `node packages/ui/tools/generate-cem.ts --check` |
| result | 3 files / 15 tests passed; `UI manifest check passed (6 declarations)`; `CEM check passed (6 modules)`; the tracked manifest and CEM are byte-identical to a fresh in-memory projection |
| provenance | `LOCAL` dirty checkout at `0b07e7ecb`; no CI run/job identity, no clean status, no packed run — advisory only |

The fixture-first tests are LOCAL dev feedback, not clean-SHA evidence. They
cannot close the `custom-elements.json` row: the live `packages/ui/src` scan has
no tag source yet (phase 2), no packed `@openelement/ui` artifact was read back,
and no `gate:release` / `gate:packed` pair ran at one SHA.

## What this note does not do

- It creates no P5 evidence, no final-SHA matrix, no capability inventory, no
  milestone exit, no sign-off, no gate result and no release claim.
- It does not rewrite the execution plan, the progress ledger, the semantic test
  matrix, the public-interface snapshot or any `packages/*` source/export map.
- It does not open Alpha16 release qualification. The owner sign-off of §13.5,
  the five §12a proofs, M13 and the publication authorization in
  `CONTRIBUTING.md`:197 remain separate, non-mergeable acts.

## 2026-11-16 amendment — shadow DSD link carrier delivered (facts only)

The generated shadow host's declared `styles` sheets are now delivered inside
the DSD template as the canonical marked links (the minimal M09-2e carrier):
the client build joins each admitted shadow declaration to its emitted asset and
fails closed when one is missing, the emitted host producer carries the typed
styleLinks channel only for that styled site, and the generated claim skips
exactly the marked prefix. Real CLI fixture evidence is three-engine LOCAL
(chromium 147.0.7727.15, firefox 148.0.2, webkit 26.4).

No row flips and no status changes: light-root document application and
client/shadow adoption (GH #1800) remain open, the dev server has no
emitted-asset carrier and fails closed, and no M09/M11 status, P5 evidence,
matrix cell or sign-off is created.

## 2026-11-16 amendment — 16b-LC nested/hostless depth-1 hooks (facts only)

This is a fact-only append. `16b-LC` remains **PARTIAL**; no gate, milestone,
capability status or P5 row is flipped, and the ADR-0180 root-only decision text
is not re-decided.

- Delivered: a direct top-level `onConnect`/`onDispose` in a **depth-1 retained
  hostless child** of the generated-element root (direct root-body reference,
  not inside a reusable JSX/list body). The child's own `<Name>__setup` factory
  records `__oe_connect` in its retained instance record and registers
  `onDispose` on the same instance owner; mount/claim replay from
  `host.setup.__oe_connect`. No dispatcher/hook slot/context/author API.
- Implementation reading adopted by the slice (owner may later rule; not a
  settled decision): hostless child **connection = its projection insertion
  lifetime** (parent disconnect ⇒ child cleanups; structural removal / owner
  teardown ⇒ child `onDispose` once, after that connection's cleanup).
- Fail closed outside depth-1 (depth ≥ 2, recipe/list bodies, non-retained
  targets, legacy-retention modules) at the authored span with
  `OEIR_LEAF_INVALID_ARTIFACT`; host-binding reads keep `UNBOUND_BINDING`;
  callback form refusals unchanged (`OEC9042`).
- Byte identity: hook-free modules and root-hook modules keep their
  pre-nested output (SHA pins green). Evidence: Node artifact suite + Chromium
  user-level suite (connect per insertion, cleanup at disconnect, setup once,
  structural-removal/teardown dispose once, throwing-connect rollback, SSR zero
  invocation). LOCAL; single Chromium engine; not M09 exit / M13 matrix.
- Still OWED in `16b-LC`: depth ≥ 2, recipe/list placement, non-retained
  targets, connection-scope helper parameters, pre-DOM timing, and the remaining
  signed-inventory rows.

## 2026-11-16 amendment — 16b-LC env parameter `{ host, signal }` (facts only)

This is a fact-only append. `16b-LC` remains **PARTIAL**; no gate, milestone,
capability status or P5 row is flipped, and the ADR-0180 root-only decision text
is not re-decided. It supersedes one item of the OWED list in the previous
amendment: the **connection-scope helper parameter** is delivered in the env
form below; the remaining OWED items are unchanged.

- Delivered: an admitted `onConnect`/`onDispose` callback may declare ONE `env`
  parameter — a plain identifier or an object binding pattern (`(env) => …`,
  `({ host, signal }) => …`). More than one parameter, rest, optional, default
  and array-pattern forms are refused with the existing `OEC9042`; zero-argument
  callbacks stay admitted and are the pre-existing form.
- Semantics: `env.host` is the generated element the connection belongs to (for
  a depth-1 retained hostless child: its nearest ancestor generated element);
  `env.signal` is the per-connection scope's own signal, aborted at the FIRST
  step of that scope's disposal (before children and before any registered
  cleanup), and a reconnect gets a fresh un-aborted signal. An `onDispose(env)`
  callback receives the element-lifetime teardown signal: it is created when the
  retained instance/child scope is created and aborted at teardown start, before
  the disposal callbacks run.
- Carrier: the element reaches generated code only through the compiler-private,
  NON-enumerable runtime property `__oe_hostElement` the shell attaches to the
  host records (`hostFor` / `instanceHostFor`). The exported host types are
  unchanged and no exported symbol is added.
- Byte identity: env-form callbacks live in their own retained record
  (`__oe_connectEnv`) with their own replay lines, and the host element is only
  forwarded in modules that declare an env-form callback. Zero-argument modules
  — hook-free and root-hook alike — keep their exact pre-change bytes (the
  existing SHA pins stay green).
- Implementation reading adopted by the slice (owner may later rule; not a
  settled decision): within one component the two forms are not interleaved —
  zero-argument callbacks replay before env callbacks, and each form keeps its
  own authored order. Interleaving would change every existing hook module's
  bytes, so it is left to an explicit decision.
- Public delta: the `onConnect`/`onDispose` parameter type is widened to accept
  the env callback (source-compatible: a zero-argument callback is still
  assignable) and `docs/release/public-interface-snapshot.json` is regenerated.
  This is a recorded interface delta, not a stability promise; the 体验版 label
  of D-17b in execution-plan §17 still applies.
- Still OWED in `16b-LC`: depth ≥ 2, recipe/list placement, non-retained
  targets, pre-DOM timing, and the remaining signed-inventory rows.

## 2026-11-17 amendment — authoring rule: a sink's dependency edge is its EMITTED expression (facts only)

Two migration findings from `open-input` that hold for every generated
component, recorded here because neither is visible in the source and both
produce a silently SSR-only surface.

### R1 — the JSX expression must read the prop inline; an alias downgrades the sink to a one-shot

The compiler derives a sink's dependency from the reads it can see **in the
expression it emits**. `hidden={props.error === ''}` emits a `__oe_refreshN`
bound to the `error` row; `const noError = props.error === ''` followed by
`hidden={noError}` emits a bare setup-time write with no edge, and the attribute
then never changes after mount/claim.

Both spellings render the right value at mount and at claim, so DOM assertions
on the initial state cannot tell them apart — only a change to the row can. Pin:
`generated-element.properties.test.ts` "a sink must read the prop inline to gain
a refresh edge" (inline: one bound sink per path; aliased: zero).

The generated lane has no authoring `computed`, so there is no legitimate reason
to alias a row-derived value in this lane; the rule therefore costs nothing and
removes a whole class of "the state is live" bugs.

### R2 — a static id inside a shadow root belongs in the template, not in a connect-time write

`onConnect` runs as a PROLOGUE, before mount/claim DOM work (the unchanged
ADR-0173 timing limit recorded in `m09-generated-element-shell.md`). Any
attribute it writes onto a compiled node is therefore a runtime write against a
claim that verified a STATIC attribute seed — `OEIR_LEAF_CLAIM_MISMATCH`, thrown
before any listener is installed, which reads in the browser as "the component
is inert".

The class lane's realm-unique id counter existed to keep SSR and CSR agreeing on
one DOCUMENT-wide identity. A shadow root is its own id scope, so the generated
lane spells the ids literally in the template: they join the static seed, the
claim passes, and the same spelling in every instance is correct rather than
merely tolerated.

### R3 — the fieldset-effective disabled state reaches component code only through the custom state

`m09-2d-forms.md` records that the shell owns the internals record and never
touches the component's DOM, so a fieldset disable does not change
`props.disabled` and does not reach the inner control. A migrated control
therefore has to consume it at the interaction, through
`host.matches(':state(disabled)')` — the same single channel `seams.md` already
declared.

A migrated control that omits that guard accepts keystrokes into a locked field
and publishes them into its value row: measured on `open-input` before the guard
existed (`hostValue: "hacked"`, control not natively disabled). The class lane
was safe only because `formDisabledCallback` mirrored the lock onto the inner
`input`; the generated lane must guard the handler instead. Evidence:
`tests/fixtures/router-ui-dogfood/e2e/ui-form.spec.ts` "a disabled fieldset seats
the effective state, refuses input, and drops out of FormData" (Chromium,
Firefox, WebKit).

Not claimed: any change to the shell's timing, any new channel, and any 16b-LC
row above. These are authoring facts about the lane as it stands.

## 2026-11-17 amendment — auto-admission and candidate collection learn the generated lane (facts only)

Migrating `open-button` (the last class-authored `@openelement/ui` component)
exposed three places that answered "is this module a component module?" with the
CLASS lane's predicate — `@element` decorator / compiled-program presence — and
therefore stopped seeing a package whose components are generated.

### The single fact

`analyzeModuleSemantics` now reports `hasGeneratedElementSidecar`: the module
carries the island policy statement (`export const openElement =
defineIslandConfig({...})` / `defineComponentConfig({...})`). The statement
locator moved to `compiler/src/internal/compiler/semantic-core/island-policy-statement.ts`
so the generated-element lane and the module-semantics fact read ONE definition
— two readers with their own locator would be the P6/P8 drift class.

Deliberately NOT derived: the TAG. It stays the manifest's identity; the sidecar
does not spell it, and the fact only answers the module-shape question.

### The three consumers

- **`derived-admission.ts`** (auto `packageIslands`): a package-owned module
  counts as element evidence when it defines a decorator tag OR carries the
  sidecar. Without this, importing `@openelement/ui/open-button` under auto
  admission derived nothing and the component rendered as an unknown element
  (measured: `<open-button variant="primary">probe</open-button>` with no DSD).
- **`style-assets.ts`** (the manual-mode "imported but not admitted" report):
  the element-file collection gains the same predicate, so a generated package
  the app imports without admitting it is still named instead of silently
  undelivered.
- **Auto-admission derivation runs on the app's real render graph** — the fix
  keeps that contract: no dependency-list or path heuristic was added.

### Recorded gap (NOT fixed here)

`collectShadowClassCandidates` still has no generated-lane branch: the
generated compiler's result carries no `classCandidates`, because a generated
component declares its utilities in the sidecar `styles` declarations and the
build's stylesheet path reads them from there. Consequence: a *config-declared*
generated component contributes no class candidates through that specific dev
entry point. The shipped build is unaffected (it compiles the module through the
generated lane and delivers the sheet), and the row that used to assert
`contributed > 0` on `@openelement/ui/open-button` now asserts its two real
contracts separately: package resolution (an authoritative entry, honestly
empty) and candidate contribution (a class-authored component). Closing this gap
belongs with the generated-lane candidate collector, not with admission.

Evidence: `packages/router/__tests__/package-import-admission-probe.test.ts`
(7/7, incl. the four install layouts and the manual-mode report) and
`packages/router/__tests__/shadow-candidate-collection.test.ts` (4/4).

## 2026-11-17 amendment — page-local components are a SEPARATE slice from islands (probe result)

Probing the next consumer surface (`www/app/site-ui/*`, migrated as a trial)
established a boundary that decides how the remaining P1 work splits.

**A component under a page-adjacent directory (`www/app/site-ui/`, imported for
registration by a class page) is NOT an island.** The build reports it under
"Foreign WC tags consumed in JSX" (`open-artifact-panel`, `open-reading-shell`,
`open-section-frame`, `open-standards-visual`), alongside the 11 real islands.
Its class-lane SSR worked because the class page's JSX resolves a custom tag
against the compiled CLASS it registered.

Migrating such a component to a function component therefore does not Just Work:
the generated element's SSR entry point is keyed to the island/package
declaration channel (an `ssrHostExport` pair for shadow, the descriptor's
`ssrProducer` for light), and a class page that merely imports the module for
registration has no such pair. Measured on `open-section-frame`:
`<open-section-frame>` serialized with its light children and NO compiled
content and NO `data-oe-light` marker, because nothing paired the tag with the
generated host.

Two facts recorded rather than worked around:

1. **The rewrite must preserve the ROOT.** `open-section-frame` was a LIGHT
   root (`data-oe-light`, content inline in the document tree). Declaring
   `root: 'shadow'` in a migration would be a behaviour change dressed as one —
   the site's document stylesheet selects the frame's DOM in the document.
2. **`serializeLightGeneratedHost` omits the marker.** The light-root producer
   path added for the local-island case emits `<tag>content</tag>` without
   `data-oe-light`, which the class lane's serializer always writes. Any
   generated light host reaching it is missing the ownership marker the claim
   path and the light-root CSS scope key off.

Neither is fixed here: both belong with the page-local-component channel (the
pairing mechanism for a generated component that is neither an island nor a
package declaration). The trial migration was reverted so the site keeps its
shipped behaviour.

**Consequence for the remaining P1 surface**: the islands
(`www/app/islands/open-search.tsx`, `apps/saas/app/islands/notes-live.tsx`) and
the page-local components are DIFFERENT slices. The islands additionally need
the non-primitive JSON seed channel (D-18c) because both declare array rows.

## 2026-11-17 measurement — why M10-P1 is still VIOLATED, and what M11-3 must actually split

Ran the report-only graph checker on the www build at `0fc4d9cd1`
(`node tools/repo/check-browser-entry-graph.ts www/dist/client/.vite/oe-browser-entry-graph.json`):

```
0 MET, 1 VIOLATED — 6 executor-entry modules loaded
  chunk: islands/element-runtime-C0NhI5Uy.js
  islands: open-button, open-cinematic-scroll, open-code-block,
           open-dragon-live-gaze, open-hero-polish, open-page-rail,
           open-search, open-theme-toggle
```

Three facts this measurement settles:

1. **The ENTRY is clean.** `islands/client.js` is 4 modules and contains no
   executor module, before and after the package-island `generatedLane` probe.
   `clientEntryNeedsElementRuntime` already answers correctly for generated
   islands, and the emitted entry no longer even defines
   `__loadElementRuntime` (`grep -c` → 0).
2. **The violation comes from the ISLAND CHUNKS, not the entry.** Each island
   chunk statically imports `element-runtime-<hash>.js`, because the generated
   shell's own module graph reaches it.
3. **The shared chunk is one 64-module bundle** holding BOTH halves: the
   generated-element shell (`generated-element/shell.ts`, `root.ts`,
   `dsd-ssr.ts`, `lifetime-scope.ts`, `runtime/instance-ledger.ts`, …) AND the
   legacy executor entries (`facade-host.ts`, `runtime-program.ts`,
   `runtime/{kernel,program-kernel,hydrate,fresh-dom}.ts`). Any generated
   component importing the shell therefore loads the executor with it.

So M11-3 is not an entry-codegen change (that part is done) and not a
`generatedLane` propagation fix (tried: propagating `generatedLane` to the
package-island branch produced **no** change to the graph — the fact was
already correct on the emitted entry, and the chunk composition is what the
checker measures). It is a **module-graph split inside `@openelement/element`**:
the generated-element surface must stop reaching the executor entries, either by
separating the shell's imports from the legacy runtime modules or by giving the
generated lane its own entry module that shares the primitives it needs
(markers, claim invariants, lifetime, security) without pulling
`facade-host`/`runtime-program`/`kernel`.

Recorded as the M11-3 starting point. The `generatedLane` propagation probe was
reverted: it changed nothing measurable, and an inert change left in the tree
would misrepresent the state.

Non-claim: this note does not move P1. It measures it.

## 2026-11-17 correction — the executor's real entry point, found after the first measurement

The earlier note said M11-3 must "split the element runtime chunk". The probe
that followed found the actual carrier, which is simpler and more actionable.

**The generated shell does NOT reach the executor.** Walking `shell.ts`'s
relative-import closure visits 25 modules and hits zero executor entries
(`facade-host`, `runtime-program`, `runtime/{kernel,program-kernel,hydrate,fresh-dom}`).

**What puts the executor in the shared chunk is the element package's ROOT
entry.** The 64-module `element-runtime-<hash>.js` contains
`element/src/index.ts`, `runtime/hydrate-install.ts` and
`runtime/blocks-install.ts` — the two deliberate side-effect imports at the top
of `index.ts` that install the hydration executor and the when/each Block
builders. 47 www modules import `from '@openelement/element'` (the root), which
is why every island chunk reaches that chunk.

So the split is not "one bundle into two". It is the existing per-feature entry
table: `./base` (neither install) and `./client-only` (no hydration) already
exist for exactly this, and `base.ts`'s own doc comment states the rule — use it
only when every island the page can upgrade is client-only AND no compiled
element in the page's client graph lowers a conditional or list Block. The
47-file decision is per-PAGE: a class page that renders `.map(...)` or a
conditional needs the blocks install, and one that claims SSR DOM needs
hydration.

**Landed in this slice (verified, but not sufficient alone)**: the compiled leaf
now imports its primitives from
`@openelement/element/internal/compiled/leaf-runtime`, a closed entry that
re-exports the same 40 symbols from their ORIGIN modules and deliberately never
from `program-kernel.ts` (whose facade re-export is what dragged the executor
in). Emitted modules show the new specifier; replacing it with the old spelling
reproduces the previous bytes exactly, which is how the three byte-pin
re-baselines were justified rather than assumed.

**Not sufficient alone**: the www graph still reports VIOLATED, unchanged, in
all three cases (`runtime chunk: 1, 64 modules, leaf-runtime absent`) because the
www islands are class-lane pages and package islands that import the root entry.
Their chunk is what the checker measures. Flipping P1 requires the 47-file
per-page entry decision above, which is its own reviewed change.
