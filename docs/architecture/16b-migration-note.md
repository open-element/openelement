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
them lives in the [historical 2026-11-15 appendix](https://github.com/open-element/openelement/blob/03e1e07e2eb87d703a9e8efbc56e6108f91472e9/docs/architecture/alpha16b-evidence-20261115.md). The
[capability inventory](./alpha16-capability-inventory.md) carries the current status.

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
| `custom-elements.json` (CEM) generation for generated elements | retained obligation (was: §13.3 exception) | M09 platform surface; M10 P3/P5; M12 packed qualification | **DELIVERED for the six migrated `@openelement/ui` components** (the tracked manifest and CEM now publish the generated elements with `ssrHostExport`; the live-input wiring landed with the component migration train; the historical phase-1 text follows). D-② phase 1 landed the input path: `packages/ui/tools/generated-element-facts.ts` runs the real generated-element lane on a fixture module, reads the emitted constructor identity from the emitted module's own export table (never the author function name), and projects the lane's resolved descriptor rows, JSX slot/part names and authored JSDoc summary into the internal manifest; `packages/ui/tools/generate-ui-manifest.ts` gains an injectable fixture root plus host site-fact dispatch, and `packages/ui/tools/generate-cem.ts` gains an in-memory projection entry that validates the result against the official CEM 2.1.0 schema (attributes/slots/cssParts preserved; no fabricated superclass or events). The tracked `packages/ui/src/generated-manifest.json` and `packages/ui/custom-elements.json` stay byte-identical — the live `packages/ui/src` tag source is not wired, so no shipped build or packed artifact declares a generated element. `m09-2b-primitive-properties.md`:348-352 "No CEM output" remains true of the shipped class-lane build, and the phase-1 implementation is uncommitted at the `0b07e7ecb` baseline with no PR or gate record. | live-input (`packages/ui/src`) generated CEM structure test; packed `@openelement/ui` metadata read back by the CEM scanner; `gate:release` and `gate:packed` green at the same SHA; the fixture-first runs are LOCAL dev feedback at dirty baseline `0b07e7ecb`, not clean-SHA evidence. The alternative owner-approved migration of the packed CEM artifact contract is recorded in the M09 exit docket (D-2, PR #1793). |
| array/object/`trustedHtml` property conversion | retained obligation (was: §13.3 exception) | M09 property/attribute conversion; M10 P5 | **DELIVERED (D-18c, 2026-11-16)** — the `data-oe-prop-seed` JSON channel carries array/object property-only rows server→client (`trustedHtml` structurally excluded); see the M09-2d 2026-11-16 amendment and the seed-channel seam row. #1789 `f69dde8bf` lands property-only channels; the slice document self-describes "bounded implemented — LOCAL review pending", no server→client seed, "not the M09 exit". Its Chromium vertical and Node contract pass at `237e14bd2` (see the Verification appendix); the consumer round-trip tests remain outstanding. | property round-trip tests for the in-tree consumers (`notes-live`, `open-article-view`, `open-reading-shell`); packed ui-app/site build; the TSX rows that carry those components. |
| form validity policy (`setValidity` rules) | retained obligation (was: §13.3 exception) | M09 forms; M10 P5; `16b-MN` | **OPEN — bounded mechanism only.** #1790 `fa6e5232d` lands `formAssociated`, value / required / disabled and `required → valueMissing`; the slice document declares an explicit "Host access gap" non-claim, "not full OpenInput migration parity", Chromium LOCAL only. Its Chromium vertical and Node contract pass at `237e14bd2` (see the Verification appendix). | the existing form e2e contract re-run on the generated CE; form value / reset / restore tests on the generated path. Full constraint mirroring (type/email, minlength, …) may stay a **deferred sub-obligation listed in this row**, never an exception (§14.2:510). |
| Two `/internal/*` artifact-resolution export subpaths | named deviation, no exemption | ADR-0137 §1 remains in force; ADR-0177 owns the written retirement condition | **OPEN — deviation registered 2026-11-14; the subpath set now numbers four** (the two ADR-0177 subpaths plus `./internal/compiled/leaf-runtime` and the public `./lifecycle`; ADR-0182's retirement conditions carry the events); `packages/element/package.json`:16-17 unchanged. | `graph:check` zero importers outside `packages/element`; `esm:boundary-check` no external resolution; snapshot zero `publicSymbols`; `gate:release` + `gate:packed` green at one SHA. Byte attribution in the full reachable page closure also remains owed (ADR-0174:42-50, :12-13). |

Before the 2026-11-15 amendments, none of the five `16b-*` slices had an
implementation slice. **State as of 2026-11-19** — the paragraph that used to
stand here said `16b-EB`, `16b-CTX` and `16b-REF` had no implementation slice;
all three now do, and each is recorded in its own amendment below:

- `16b-LC` (lifecycle) remains **PARTIAL**: the generated-element ROOT author
  lifecycle hooks are delivered, while nested/hostless hooks and the
  connection-scope helper channel are still OWED.
- `16b-EB` (error boundary) — **PARTIAL BY DESIGN** (`ee0434c9f` +
  `9e494db63`, followed by the §19.2 SSR fallback). Alpha16 uses the existing
  host identity for literal SSR fallback, retries a rolled-back connect on
  reconnect and keeps the update subscription or event listener live for later
  recovery. The [boundary entry below](#2026-11-25-policy-ssr-and-recovery)
  records the migration scope and evidence.
- `16b-REF` (refs) — delivered (`d135576d0`): `ref(cb?)` is a compiler-erased
  declaration intrinsic riding the EXISTING `ref` JSX channel, so no second
  attachment mechanism exists; lifetime is proven across mount, claim,
  disconnect and reconnect.
- `16b-CTX` (context, TSX-13) — delivered (`e8ea72b95`): `provideContext` /
  `useContext` over the generated owner tree with hostless owners, nested
  shadowing, sibling-subtree isolation, provider-change re-read, disconnect
  cleanup, reconnect re-registration, AND server rendering (the enclosing
  scope rides the producer argument list, so per-render isolation is
  structural).

Each amendment records what is NOT claimed. None of them flips a milestone
status in `alpha16-18-progress.md` by itself; that is the milestone ledger's job.

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

> **Superseded 2026-11-21: `16b-LC` is MIGRATED.** Depth >= 2 retention landed
> (ADR-0181's cross-ledger transaction amendment): a retained body that retains
> its own children joins the root attempt's transaction, keeps its record across
> reconnect, and an aborted attempt never commits a child pass. What stays
> refused is PLACEMENT (recipe/list bodies, components no retained body
> references) — a boundary of a compiled setup, not missing depth. The text below
> is the 2026-11-15 state and stays as history.

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
[M09-0 shell record](https://github.com/open-element/openelement/blob/8d50588914ea32f7b76ad8280d66496449273f29/docs/architecture/m09-generated-element-shell.md) and in
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

> **Later reading (2026-11-20).** The "Owed" list above is the 2026-11-15 state
> and two of its items are stale: depth-1 nested/hostless hooks are delivered
> (`56394eb67`; the 2026-11-16 amendment below) and the connection-scope helper
> parameter is delivered in `env = { host, signal }` form (the second 2026-11-16
> amendment below). Still owed in `16b-LC`: depth ≥ 2, recipe/list placement,
> non-retained targets, pre-DOM timing and the remaining signed-inventory rows.
> The 2026-11-20 remediation corrects the matching capability-inventory row.

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

- ~~document-level application of the emitted sheet on a light root~~ —
  **DELIVERED (2026-11-20)**: a light-root render reports the island's declared
  sheets to the render's document sink;
- ~~shadow-root adoption: no DSD style-link carrier until M09-2e~~ — **the carrier
  exists and the declaration is ADMITTED**: the compiler emits the typed
  `styleLinks` channel and the serializer writes the canonical marked `<link>`
  inside the template. The `OE_ISLAND_STYLE_SHADOW_UNWIRED` refusal now fires only
  for the honest case (a shadow island whose leaf emitted no producer, so there is
  no template to declare the sheet in). What remains owed is the CLIENT-side
  shadow adoption slice, not the carrier;
- a non-generated/class-lane module declaring `styles` is refused with
  `OE_ISLAND_STYLE_LANE_UNSUPPORTED`; its sheets belong to `static styles`.

The adoption surface was carried by GH issue #1800 (originally scheduled as an
Alpha17 item; that milestone number was retired on 2026-11-21 and its scope folded
into the Alpha16 closeout — see the plan's §19.10) and the shadow carrier by
M09-2e; M11 still re-verifies the deferred client style declaration
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

### R1b — what a tracked JSX slot actually admits (measured)

R1 says "inline the read at its sink". That is necessary but not sufficient: the
slot grammar is narrower than "any expression". Measured pairs, all compiled in
this tree:

| spelling at a child slot | result |
| --- | --- |
| `{props.count * 2}` | admitted, TWO bound refresh functions (mount + claim) |
| `const d = props.count * 2; {d}` | admitted, **ZERO** bound refreshes — compiles, SSRs correctly, never updates |
| `{props.locale === 'zh' ? 'ZH' : 'EN'}` | **refused**: "a conditional branch must be JSX or null" |
| `{label(props.locale)}` where `const label = (l) => …` | admitted, TWO bound refreshes |

So the rule has three parts:

1. a VALUE (arithmetic, member read, template literal, a call to a
   component-local `const` ARROW) may be inlined at its slot;
2. a CONDITIONAL that must yield TEXT cannot be a ternary in a child slot — use
   a component-local `const` arrow returning the string. Attribute positions DO
   admit ternaries (`hidden={a ? b : null}` is the documented pattern);
3. never bind the value to a local first and read the local: that is the
   zero-refresh row above, and it is invisible in SSR.

A local function DECLARATION called in a tracked slot is refused (OEC9041); the
`const` arrow form is the one that works.

### R1c — a BARE boolean attribute is STATIC; an expression is DYNAMIC (measured)

This is the inverse of the intuition, and it is invisible in SSR. Measured on the
real compiler:

| JSX | claim static seed | runtime write is |
| --- | --- | --- |
| `hidden` (bare shorthand) | `[{ name: "hidden", value: "" }]` | **a claim violation** |
| `hidden={true}` | `[]` + `hidden` in the dynamic skip list | safe |

Same rendered bytes (`hidden=""`), opposite safety. A bare boolean is literalized
into the static seed; ANY expression — even a constant — joins the claim's dynamic
skip list. So a component whose CONTROLLER owns an attribute at run time must
spell it as an expression, and the repo's `react/jsx-boolean-value` lint rule wants
exactly the broken spelling, so that one line needs a disable with the reason.

The same trap has a second face: `hidden={!props.searching}` looks safer and is
worse. The props record has ONE coarse change signal, so that write re-runs on
every props commit — when results land (`searching: false`, the dialog must stay
open) it slams the overlay shut. A CONSTANT expression binds no dependency, so it
never refreshes and the controller stays the sole runtime writer.

### R1d — a static directory of sibling elements is consumed permanently

Three plain sibling `<span>`s compile to a static-sibling DIRECTORY, and a
directory claim that commits every declared range stays permanent. A reconnect
then re-claims a directory it can never reopen and throws
`OE_RUNTIME_STATIC_RANGE_MISMATCH`. Rendering the same three elements from a small
list (`{[0, 1, 2].map((row) => <span key={row} … />)}`) produces the same bytes and
re-arms on every connection.

Both findings came from ONE migration (`open-search`) whose acceptance was a live
e2e: a markup assertion would have passed while the dialog was broken after every
reconnect.

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

### The boundary that decides M11-3's order: a class page cannot drop the root entry

Following the correction above one step further settles the sequencing.

The hydration executor is consumed through a seam, not through the root entry's
identity: `runtime/kernel.ts` imports `hydrationExecutor` from
`runtime/hydrate-seam.ts`, and `hydrate-install.ts` is the only thing that
installs it. So any graph that runs a COMPILED CLASS element's claim path
reaches the seam, and dropping the root entry's side-effect import does not
remove the executor from the graph — it removes the INSTALL, which makes the
claim fail closed at runtime.

That is why 47 www modules import `from '@openelement/element'`: almost all of
them are compiled CLASS components (`layout.tsx` plus the article-route
components), and a class component's claim needs the installed executor. Moving
their import to `./base` or `./client-only` would be a build that ships and a
runtime that throws.

**Consequence for P1 and for M11-3.** P1 can only be satisfied by removing the
CLASS lane's participation from the production browser graphs — the same
retirement the five proofs (P1–P5) describe — not by re-pointing imports. The
generated-lane islands already avoid the executor (measured: shell closure = 25
modules, 0 executor hits; entry chunk = 4 modules with no
`__loadElementRuntime`). What keeps the chunk alive is the class pages sharing
it.

So the remaining order is: finish the consumer migrations (which is where the
class components in `www/app/components/` and `apps/saas/` still are), then P1
flips as a consequence, and P2–P5 record it. This slice's leaf entry is the
first half of that story: it removes the generated lane's OWN contribution to
the executor's reach, so when the class lane leaves, nothing keeps it.

### Why a page-local component cannot be migrated yet: it has no TAG

Attempting `open-page-rail` (the www table of contents) settled the remaining
question about `www/app/site-ui/*`. The build failed with:

```
<open-page-rail> (OpenPageRail) has no compiled Part Program
```

and the reason is upstream of any registration: **the generated lane never
recognized the module at all.**

`createGeneratedElementSiteResolver` — the ONE source of a generated module's
tag — derives it from exactly two places:

1. a package island's manifest (`packageSites`), or
2. the islands directory, via `transformIslandSource` + `pathToTagName`.

A module under `www/app/site-ui/` is neither. With no site, the transform
declines the module (by design: "recording a host identity here would be a fact
the build never honours"), so no element class and no `__ssrHost` is emitted, and
the class page that imports it for registration keeps rendering the class-lane
version — or, after a naive function-component rewrite, an unknown element.

So the missing piece is not a registration hook in `entry-orchestrator` (that
half already exists and already pairs `__registerSsrIsland`), and not a
`StaticComponentDecl` field. It is a **tag source** for a component that is
neither an island nor a package declaration.

Three candidate designs, none settled, and the choice is the owner's because each
changes the authoring surface:

- **A sidecar `tag` field** (`defineComponentConfig({ tag: 'open-page-rail' })`).
  Explicit, no inference, and it makes the component's identity authored rather
  than derived. Costs: a new sidecar key, and the duplicate-tag guard must cover
  it.
- **Derive from the module filename in a configured component root** (the
  islands rule generalized to a `componentsDir`). Cheapest, but it re-introduces
  the path-derived tag identity the package lane deliberately avoids.
- **Derive from JSX usage** (the class page names `<open-page-rail>`). No
  authored change, but it is inference from a consumer, and a tag typo would
  silently create an unregistered element instead of failing closed.

Until one is chosen, `open-page-rail` and `open-search` stay class-lane, and the
www article-route components (which also live outside the islands tree) stay with
them. The trial migration was reverted.

This is the LAST structural blocker between the current state and the remaining
consumer migrations. Everything below it is mechanical.

### The second boundary: an app-local module's value cannot be CALLED in a JSX slot

Retrying `open-page-rail` inside `app/islands/` (where the lane DOES admit the
module) surfaced a different gate:

```
OEC9043 [OEIR_UNCLASSIFIED_BINDING] binding 'readingChromeStrings' has an unknown
value kind in a tracked slot; import 'readingChromeStrings' from
'../site-ui/chrome-strings.ts' was not classified by the host
```

The generated lane classifies every value that appears in a tracked slot
(a JSX child, an attribute value). A named import from an app-local module is not
in that classification set: the host's admission descriptors
(`StaticSidecarDescriptor`, `ModuleVocabularyDescriptor`) carry only
`'static-sidecar'`, `'page-definition'` and `'element-registration'` kinds — there
is no "ordinary function value from an arbitrary module" kind, by design, because
admitting one would make the lane depend on the whole app module graph.

`notes-live` migrated cleanly because its app-local import is only CALLED INSIDE
`onConnect`/`onDispose` callbacks, whose bodies are not value-classified. The rail
calls `readingChromeStrings(props.locale)` directly in a JSX child and an
attribute, which is exactly the classified position.

Consequences for the remaining www components:

- `open-page-rail` can still migrate, but the localised strings must come from a
  lane-admitted source: either the two labels become declared rows the caller
  passes (they are pure derivations of `locale`), or the strings are inlined.
  Either is a component-shape decision, not a mechanism gap.
- `open-search` is the harder case: its controller (Zag combobox) is consulted
  from render-time reads, so the same gate applies more broadly.
- The article-route components pass a large `model` object straight into
  `<open-article-view model={...}>`; that is a declared row, which the JSON seed
  channel now carries, so they are the most tractable of the remaining set.

### Process note: a new package SUBPATH has four consumers, not one

Adding `@openelement/element/internal/compiled/leaf-runtime` cost three CI
round-trips because the entry has to appear in four places, and the local
`check` covers none of them:

1. `packages/element/package.json` `exports` (and the generator's table in
   `packages/router/src/vite/generated-export-files.ts` — the `--check` task
   compares the two).
2. `packages/element/README.md` — the pre-push gate refuses an undocumented
   public subpath.
3. `vitest.config.ts` aliases — the browser test projects resolve package
   subpaths to monorepo source through this table, so a missing row surfaces as
   `Failed to fetch dynamically imported module` in the element-browser suite.
4. `docs/release/public-interface-snapshot.json` — a new subpath is a public
   shape delta (`interface:snapshot:write`, which the local `check` does not run).

The test helper `apps/saas/app/__tests__/compile-page.ts` has the same shape for
its own rewrite table (it must rebase EVERY element subpath, and the emitted tail
is JSON-quoted while authored imports are not). Both are listed here so the next
subpath addition does not rediscover them.

## 2026-11-18 ruling — `trustedHtml` stays out of the seed channel

Owner-delegated decision, made from a design review recorded in the lane's
`TRUSTED-HTML-TRANSPORT-DESIGN.md`. **The D-18c exclusion is kept; no transport is
built.** The two components previously assumed to be blocked on it must change
SHAPE instead.

The decisive arguments, each checked against the tree:

1. **The brand is an identity claim about a call site, not a value.** `security.ts`
   keeps a module-private `WeakSet<object>` and `isTrustedHtmlValue` is
   set-membership on OBJECT IDENTITY — deliberately not a structural check. Its
   own comment says "the trust does not serialize". Any transport ends with a call
   that mints a brand from bytes that crossed a wire, which converts a provable
   refusal into a silent success. That is the raw-markup channel this repo
   already forbids in the DSD leaf, in `__h`'s single reserved key, and in D-18c
   itself.
2. **The transport would not have unblocked either component anyway.** The
   generated lane refuses every `innerHTML` sink outright (`OEC9044`,
   `function-frontend.ts`), and refuses a `signal`/`computed` local as an unbound
   host binding (`OEIR_GENERATED_ELEMENT_UNBOUND_BINDING`). Measured: for one of
   the two components the `trustedHtml` count is ZERO and the `computed` count is 21.
3. **They are not islands and have no sidecar.** They are reached only through
   page/layout/static-component import graphs, and the client bundle's only
   scripted entry is the island entry — so a seed for them would today describe a
   claim that never runs.

Consequence for the remaining surface, stated so the next lane does not re-derive
it: `open-reading-shell` needs its 21 `computed` rows collapsed or inlined (no
transport work is useful); `open-article-view` needs its article body to stop
being a runtime string (which removes the `trustedHtml` row and its sink
together), or it stays on the class lane, which already works. If a future owner
overrules this, the only defensible design is a request-scoped unforgeable token
minted with the brand and verified at the claim — a signing subsystem, recorded
as its own ADR, and still unable to prove anything about the original call site.

## 2026-11-18 ruling — no `computed` support in the generated lane; inline instead

Owner-delegated decision from a design study of `open-reading-shell` (21 `computed`
fields, zero `trustedHtml`). **The lane gains no component-authored `computed`.**
The 21 fields inline at their sinks; the two that produce arrays change to an
inline form of the same value.

The reason is not effort, it is correctness. The generated shell's `props` is a
frozen record of plain getters over a `Map` with ONE coarse `propsChanged`
signal (`shell.ts` `createState`). A `computed` closed over that record tracks
no signal, so it would compute once and go permanently stale after the first
property write — the exact "silently SSR-only surface" class this lane exists to
remove. Admitting it would ship a mechanism whose first bug is invisible in SSR.

Measured, so the migration rule is not advice but a fact:

- `return <p>{props.count * 2}</p>` → two bound refresh functions (mount +
  claim), i.e. reactive;
- `const doubled = props.count * 2; return <p>{doubled}</p>` → **zero** bound
  refreshes. The module compiles, SSR renders correctly, and the value never
  updates again.

That pair is why 16b-migration-note R1 (inline the read at its sink) is a
correctness rule, not a style preference, and it is why the lane's own refusal of
a non-`local` resource is right: a `computed` local is a `local` kind whose
reactivity the emitter cannot reproduce.

Corollary the study also verified: a local `const` ARROW is admitted and stays
reactive, so the one real cost (a locale-string helper at ~9 sinks) needs no new
capability — a component-local arrow already expresses it. A local function
DECLARATION called in a tracked slot is refused (OEC9041), which is a sharp edge
worth a test if that idiom becomes the documented migration pattern.

Verified: probe pairs above compiled in this tree; compiler suite green.

### Third gap measured: a static generated light producer has no children channel

Two defects on the page-local path were fixed (`01a63e27f`): the declared tag now
reaches the SSG admission set, and `__ssr` now recognizes a generated light root.
With those in place the emitted content DOES contain the component's full
`<section part="panel">` shell and its `<slot>` elements — verified by reading
the emitted `P__ssr()` body, so the earlier "missing shell" was admission, not
serialization.

What remains, measured: a fully static generated component's producer is
PARAMETERLESS — `export function P__ssr()` — and its `<slot>` elements are
emitted EMPTY with no per-slot marker:

```
"<section>" + markerText(rangeMarker(0)) + "<p>" +
  "<slot name=\"label\"></slot>" + "</p>" + … + "</section>"
```

The class lane substitutes projections because it serializes a Part Program whose
structure it can walk (`serializedSeams` + `consumedProjections`). A generated
light content is a finished STRING, and the only markers in it are RANGE markers
around element subtrees — not anchors at the slot positions. So there is no
reliable way for the serializer to inject the caller's children into the right
slot from outside.

Consequences, stated so the next lane does not try the two shortcuts I rejected:

- **String-replacing `<slot …>` is not acceptable.** Without a marker the
  replacement would have to pattern-match markup, which is exactly the
  source-text surgery this repo forbids (and it would break the moment a slot
  gains an attribute or a consumer nests one).
- **Giving the producer a `children` parameter is not obviously right either.**
  It would make a supposedly pure content producer take a caller-supplied value,
  and every other generated producer (the shadow `__ssrHost` included) is
  content-only.

So this is a COMPILER slice: emit a per-slot anchor (the same marker discipline
the claim path already uses) so the serializer can substitute without parsing.
It is required before a page-local component that RECEIVES children can migrate;
a leaf-only page-local component is unaffected.

`open-artifact-panel` is therefore still class-lane, and its trial migration is
reverted. It takes three slotted children at five call sites.

### Third boundary: a CLASS page's nested expansion bypasses the generated descriptor

`open-page-rail` cannot migrate yet, for a reason none of its own code decides.
Its five call sites are CLASS pages and class components
(`open-article-view.tsx`, `roadmap.tsx`, `reference.tsx`, `errors.tsx`,
`changelog.tsx`), which render `<open-page-rail items={…} locale={…}>` through
the class lane's nested expansion. That expansion serializes the rows as ORDINARY
host attributes:

```
<open-page-rail items="[{&quot;id&quot;:&quot;request-boundary&quot;,…}]" locale="en">
```

Measured consequences in the built page:
- `items` becomes a huge attribute string instead of riding the JSON seed the
  generated descriptor declares (`attribute: false`);
- `data-oe-light` is absent, so the generated light serializer never runs.

So a class caller does not consult the CALLEE's descriptor at all — it applies its
own attribute rules. That is the mirror image of the second boundary (a generated
component cannot call an app-local value in a tracked slot): the two lanes can
compose ONLY through the mechanisms each recognises, and a class caller's nested
expansion is not one of them for a generated light child.

Two mechanisms this slice DID land while probing it, both independent of the
migration:

1. `__ssr` for a light root now returns `{ content, hostAttributes }` so the
   seeded `data-oe-prop-seed` pairs reach the host tag (`f71f45373`). A string
   result is still accepted, so an older emitted module is byte-identical.
2. The scrollspy deferral pattern works and is written down: `onConnect`
   schedules the install on a task, `env.signal`'s abort cancels it (the signal is
   per-connection and aborts BEFORE the returned cleanups, so a stale task cannot
   fire into the next claim). `@openelement/ui/instance-state` was tried first and
   rejected — importing it pulled the cinematic-scroll island's chunk into the
   rail's chunk.

Until a class caller can render a generated child through the child's own
descriptor, `open-page-rail` stays class-lane, and so does `open-reading-shell`
(its only caller relationship is the same shape).

## 2026-11-18 amendment — `16b-EB`: `onError` and the generated lane's three capture points

`onError(cb)` is the FOURTH compiler-erased intrinsic of the generated-element
lane. It is the author-facing error boundary; the class lane's
`ErrorBoundary`/`_captureError` service is NOT reused, and no second error
channel, scheduler or retry loop is introduced.

### Admission is the existing rule, unchanged

Placement and provenance are exactly `16b-LC`'s (`function-frontend.ts`
`buildLifecycleHook`): a direct top-level statement of an admitted
generated-element setup, callee resolved by BINDING PROVENANCE (a named import
of `@openelement/element`, aliases followed), exactly one inline
arrow/function-expression callback, no type arguments, no generator, no `async`,
and zero or one plain `env` parameter (identifier or object binding pattern; no
rest, optional or default form). Refusals keep the existing `OEC9042` form code;
a non-intrinsic statement keeps the existing `OEC9041` component-body refusal.
No new diagnostic identity and no new public error code.

The generator owns placement, as for the other three names: the handler is
carried only by the generated element ROOT setup or a depth-1 retained hostless
child setup. Depth >= 2, recipe/list bodies and non-retained targets fail closed
at the AUTHORED span with the existing `OEIR_LEAF_INVALID_ARTIFACT`.

### The env is `{ host, signal, states, error }`

`host` is the generated element the failing work belongs to (the nearest ancestor
generated element for a depth-1 retained hostless child), `signal` is the
`LifetimeScope` signal of the phase that threw, `states` is a getter over the one
element-lifetime `ElementInternals` record (attached only if the handler reads
it), and `error` is the thrown value EXACTLY as thrown — never wrapped. The
zero-argument form is admitted and simply ignores the env, exactly like the
other three intrinsics.

### The three capture points

Connect and claim share the shell catch. Refresh and event dispatch share
`guardUpdate`.

| phase | capture point | what was already there | with a registered handler | with NO handler |
| --- | --- | --- | --- | --- |
| connect / claim | the shell's `connectedCallback` `catch` (covers `rootFor`, setup, `createRecipe`, mount, claim and the `onConnect` replay) | rollback of the failed attempt (instance pass abort, connection scope, first-connect instance teardown, retained-child release) then **rethrow** | the SAME rollback runs, then the handler runs and the error does not escape | the pre-`16b-EB` rollback-then-rethrow, byte-identical |
| update / refresh | the executor's existing `guardUpdate(fn, sink)` that the generated `bindSignalWrites` subscription and `each`/`when` refresh closures are wrapped in | a throw propagated out of the signal writer (out of the property setter) | reported to the handler; the subscription stays live, so the next write writes | `guardUpdate(fn)` keeps the propagating form — generated text is the unchanged two-name call |
| event dispatch | the same `guardUpdate` wrapper around the emitted DOM listener | a throw escaped as uncaught platform dispatch | reported to the handler; the listener stays installed | the unwrapped `(event) => handler(event)` listener, unchanged |

**What "defined state after a caught connect error" means concretely.** The
element is exactly where the pre-existing rollback leaves it, minus the escape:

- `state.projection` and `state.connection` are `null` — the failed attempt
  mounted/claimed nothing;
- no generated DOM was inserted, and none of the attempt's listeners,
  subscriptions or child scopes survive (the connection scope and the failed
  first-connect instance are both disposed, and a failed first connect destroys
  its instance so setup re-runs on a NEW one);
- the region fact is **not** rewritten by the failure, so the next connect makes
  the same mount-vs-claim decision it would have made;
- `state.connecting` is `false` (the `finally` runs on both paths);
- the handler's list is **snapshotted before** the rollback clears it, so the
  boundary reports the error even when the failure destroyed the very instance
  that registered it;
- a later reconnect retries from scratch and succeeds once the throw source is
  gone (Chromium row D1 proves the retry and that the retried element's listener
  works).

`env.signal.aborted` distinguishes the phases honestly: the connect env carries
that connection's signal, which the rollback already aborted, so it is `true`; an
update-phase env carries the instance-lifetime signal, so it is `false` while the
instance lives.

### No silent swallow, and a throwing handler

- No handler registered ⇒ every capture point keeps its pre-`16b-EB`
  behaviour. There is no default handler, no `console.error`, no
  `window.onerror` installation.
- A handler that itself throws **replaces** the original: its error is what
  escapes, thrown after the rollback completed. Every registered handler is
  still run (the same first-error rule the change channel uses), and `env.error`
  keeps the original reachable. Chromium row D3 pins that the original is NOT
  the surfaced error.

### Async rejections are OUT OF SCOPE for this slice — and why

No capture point promises to catch a rejection. The two `LifetimeScope` signals
are the honest hook (`env.signal` aborts at the start of a disconnection and the
instance signal at teardown start), but wiring them to rejections would require
either a scheduler or a global `unhandledrejection` listener — both forbidden by
this slice, and neither attributable to one element: a browser reports an
unhandled rejection without saying which element produced it. So a rejected
promise inside an authored callback behaves exactly as it did before `16b-EB`:
it is unhandled, and the platform reports it. An author who wants a boundary over
async work uses `env.signal` with their own `catch`. Recorded here as the
deliberate boundary, not as an oversight.

### SSR

The enclosing render handles SSR reporting and fallback through the option
below.

### 2026-11-25 policy: SSR and recovery

When an admitted nested host expansion throws, a render with
`onNestedFailure` reports the original thrown value and contributes the
caller's literal fallback markup. If the reporter returns normally, healthy
siblings can continue expanding. If the option is omitted, the original
exception propagates. The generated component registers `onError` during
client activation.

The fallback represents the existing unexpanded host. Normal claim adopts its
nodes according to the existing region and ownership rules. On the client a
connect or claim failure rolls back the attempted projection and its resources,
preserving borrowed nodes. Reconnecting runs the normal mount or claim path
once the cause is gone. A captured refresh or event error leaves its subscription
or listener live. Pre-connection property reconciliation and seed validation
take place before the shell's capture point.

An author-facing reset API, a separate fallback identity, cross-custom-element
client capture and async rejection capture are outside the Alpha16 policy.
[ADR-0182 decision](../adr/ADR-0182-function-component-capability-api.md#amendment-2026-11-25-16b-eb-fallback-and-recovery)

### Bytes

A module that does not use the intrinsic is byte-identical to its
pre-`16b-EB` output: no `guardUpdate` import, no channel property on the host
literals, and the unchanged two-name `bindSignalWrites` call. Pins:
`generated-element.error-boundary.test.ts` B4 (a module using all three older
intrinsics plus a tracked slot and an event handler) and B5 (the SSR producer).

**Historical evidence.** The 2026-11-20 run at
`f514c1290539993f9bdbeca9b02b6f99ca0a4dff` exercised the boundary guard within the
full compiler suite (95 files, 1,386 passes). The run preceded the SSR fallback
evidence. Execution plan §18.3 records the initial fallback deferral and §19.2
records the same-day reversal and delivery conditions. The P5 capability
inventory records evidence provenance and the unsigned §13.5 status.

## 2026-11-19 amendment — R4: a full generated-lane page has no runtime loader, so document services come from the executor-free subpath (facts only)

### R4 — the page floor cannot re-install document services through the lazy `element-services` import

The rule, stated flatly: **a page whose islands are ALL generated-lane has no
element-runtime loader.** `clientEntryNeedsElementRuntime()` returns false for
that shape (M11-3), so the generated entry emits no `__loadElementRuntime` and no
dynamic `import()` of the `element-services-*` surface. Any document-level
service the entry needs must come from the executor-free
`@openelement/element/document-services` surface
(`packages/element/src/document-services.ts`, wrapper
`packages/router/src/vite/internal/ssg/element-document-services.ts`) —
**never** by restoring the lazy `element-services` import, which would re-emit
the loader and give back the P1 win this shape exists to keep.

Two document-level services were installed by that lazy import as a side effect,
and only by it: deep fragment navigation across nested shadow roots (#1090) and
the bounded pre-hydration click capture. Measured regression on the
all-generated-lane shape: `page-structure.spec.ts`'s "deep fragments scroll
inside DSD" case fails because `#start` never receives `data-open-target`. The
two installers are the same function objects the root entry exports, so the
narrow surface forks no implementation.

The shape, measured:

- The entry now carries a STATIC import edge to the shared
  `element-runtime-<hash>.js` chunk — unavoidable, because the #1544 chunk
  grouping puts every module under the resolved element package root in that one
  chunk, and the wrapper is one of them. The old build-output assertion "the
  entry has no static edge to the runtime chunk" was a PROXY for the real
  property on the shape it was written for (class-lane present ⇒ lazy loader ⇒
  no static edge). It is retired and restated as the property itself
  (`www/__tests__/build-output.test.ts`): the page floor carries no executor
  entry module (judged from the emitted `.vite/oe-browser-entry-graph.json`
  artifact, the same evidence the P1 checker judges), the runtime chunk holds no
  executor entry, and a page without the runtime modulepreload does not
  reference the runtime chunk. Asserting the edge's ABSENCE would now assert the
  absence of the document services.
- Static install cost: **324 KB → 328 KB raw, 87 KB → 89 KB gzip**. That is the
  whole price of the surface, and it is floor bytes every page already pays
  (nothing new is fetched by any island).
- **P1 stays MET.** The emitted `element-runtime-<hash>.js` chunk holds 38
  modules and NO executor entry; the checker's verdict on
  `www/dist/client/.vite/oe-browser-entry-graph.json` is unchanged. The static
  edge lands on a chunk that is executor-free by construction, which is exactly
  why the surface's zero-executor closure is pinned in
  `packages/element/__tests__/document-services-subpath.test.ts` — one executor
  edge into either leaf would make the page floor load the generic Part Program
  executor.
- e2e: **368/368 passing**, with the previously failing deep-fragment case green.

### The two authoring facts this migration proved

**(i) A default export that is a RE-EXPORT is structurally declined by the
generated lane.** An island module written as `export { default } from
'./component.tsx'` (or any re-export of the component) is recorded as
`{"kind":"lane-declined","reason":"compiler-declined"}`: the lane decides from
the module's own body, and a re-exported default is a binding it cannot see
through. The component body must live IN the island module itself, the way
`www/app/islands/open-search.tsx` does. The consequence is silent — the island
degrades to the class lane (or to no generated host at all) rather than erroring
— so this is the first thing to check when a migration "works" but produces no
generated host producer.

**(ii) `onConnect` runs in the claim/mount PROLOGUE, before the generated DOM
walk.** The handler is emitted into the prologue of the claim/mount path
(`shell.ts` runs it from `connectedCallback` before `claimRecipe` /
`insertRecipe`), so it executes BEFORE the generated lane walks the rendered
subtree. A handler that scans that subtree (querying for descendant nodes,
measuring, attaching listeners per child) therefore sees a region that is not the
rendered tree yet. One MACROTASK (`setTimeout(…, 0)`) lands the scan after the
synchronous connect pass, which is exactly when the class lane's
`connectedCallback` used to run — this is what `www/app/islands/open-page-rail.tsx`
does. The failure is permanent, not a missed first pass: a scanner that records
its state before its empty-target early return binds the host to zero targets for
the life of the connection. Handlers that only read `env.host` / props / signals
need no deferral.

## 2026-11-19 amendment — `16b-REF`: `ref(cb?)` and the generated lane's node handle

`ref(cb?)` is the FIFTH compiler-erased intrinsic of the generated-element lane.
It is the author-facing REFS capability (CAP-11); the class lane's
`this.<field>` ref grammar is NOT reused, and no second attachment mechanism,
sink kind or ABI change is introduced.

### The shape, and the evidence that decided it

The emitter ALREADY had an intrinsic `ref` JSX CHANNEL (`m09-2c`,
`generated-leaf/generate.ts` `emitClientOnlyInstall`): on attach it evaluates
the expression once, validates it is callable, calls it with the element, keeps
the returned cleanup, and on detach runs that cleanup and then calls the
expression with `null`. It also classifies `ref` in the frontend's `handler`
mode and excludes it from SSR bytes and from the claim attribute seed. What the
channel could NOT express was **a handle that survives a mount/claim/reconnect**:
the author had only a local, and the retained setup factory aliases setup
values through a `const`, so a `let field = null` written from a `ref` callback
never survives — measured on the real compiler, the emitted alias is
`const field = __oe_requireRootSetup("field")` and the assignment throws
`TypeError: Assignment to constant variable`.

So the slice adds a HANDLE VALUE whose callable form is exactly what the
existing channel already accepts, and builds it inside the retained setup
factory. That is why the chosen authoring surface is a declaration intrinsic
rather than a new JSX attribute form:

```tsx
import { ref } from '@openelement/element/lifecycle';

const field = ref<HTMLInputElement>((element) => {
  element?.focus();
  return () => {/* detach cleanup */};
});
// … return <input ref={field} />;
```

`ref <JSX attribute>` is unchanged and stays the plain-callback channel; the new
name is the HANDLE FACTORY. A `ref` attribute value that is a handle is
indistinguishable from a callback to the emitter, which is the point: no sink
kind is added and the attach/detach/cleanup ordering is the existing one.

### Admission is the existing rule, unchanged

Placement and provenance follow `16b-LC`/`16b-EB` (`function-frontend.ts`
`buildRefHandle`): a `const` declaration whose initializer is a call resolved by
BINDING PROVENANCE (a named import of `@openelement/element` or
`@openelement/element/lifecycle`, aliases followed) to `ref`. The call takes at
most one argument, and that argument (when present) is an INLINE synchronous
arrow/function expression with zero or one plain-identifier parameter. Refusals
keep the existing `OEC9042` form code; no new diagnostic identity and no new
public error code.

The handle must be declared `const`. The handle IDENTITY is the contract
("reconnect observes the same object"), and the emitted alias is not
reassignable, so a `let` fails closed at build instead of diverging at runtime.

`ref(...)` is a DECLARATION form, not a value. A call in any other position
(`ref={ref(cb)}`, a property initializer, a nested call inside a notification)
is refused at the authored span with the same `OEC9042`; without that refusal it
would survive into the emitted module as a call to the fail-closed stand-in and
throw at MOUNT — a build defect surfacing as a runtime one.

### Lifetime: mount, claim, disconnect, reconnect

| phase | what happens |
| --- | --- |
| mount | the retained factory builds ONE handle object (`current = null`, plus the optional notification); the mount body aliases it and the existing `ref` channel attaches it, so `current` is the CREATED node |
| claim | the same alias; the channel attaches the ADOPTED server node, so `current` is the node from the DSD template (asserted by identity in Chromium) |
| update | nothing: the handle is not a tracked slot and no update path touches it; a node rewrite in place keeps the same reference |
| disconnect | the channel's scope cleanup runs the notification's returned cleanup, then calls the handle with `null`, which clears `current` — cleanup BEFORE clear, so a cleanup observing `current` still sees the node |
| reconnect | the retained record still holds the SAME handle object (a reconnect is a new connection, not a new instance), so the channel re-attaches and `current` is repopulated |

Exactly one construction site is emitted per handle, and the cleanup runs
exactly once per detach even when it throws (the channel's `try { cleanup() }
finally { handle(null) }`).

### `current` is not a reactive source — and the compiler says so

`current` is written on attach and cleared on detach; it notifies nothing. A
TRACKED slot reading it would therefore emit a one-shot value that never
refreshes — the "silently SSR-only surface" class this lane exists to remove.
A handle may be read from a `handler`-mode expression (a `ref` attribute, the
`ref(...)` notification, `onConnect`/`onDispose`/`onPropertyChange`/`onError`
bodies, a DOM event handler); a read from a tracked slot fails closed at the
authored span with `OEC9042` and a message that names the allowed positions.

### What is NOT claimed

- No component ref (a handle to a child COMPONENT instance) — ADR-0182 keeps
  that FUTURE.
- No reactivity: reading `current` in a tracked slot is refused, not converted.
- No ref on a custom-element host or inside a list-entry template: those remain
  the pre-existing `OEIR_LEAF_UNSUPPORTED_ATTRIBUTE` refusals of the channel.
- No SSR handle and no server notification: `<Name>__ssr` bytes are unchanged
  and the handle is never built on the server.
- No `useHost`-style host accessor (a separate D-17b item) and no change to
  `env.host`.

> **Later reading (2026-11-20).** `useHost` is recorded as **FUTURE/OWED**: it is
> listed in ADR-0182 D-18b-4 and execution plan §17.1 as a separate D-17b item,
> it is NOT implemented, and it is not part of the experience edition's
> delivered surface. The 2026-11-20 remediation records that status (ADR-0182
> amendment + the capability inventory) and deliberately does not implement it;
> `env.host` (connection-scope) stays the only delivered host access.

### Bytes

A module that does not use the intrinsic is byte-identical to its
pre-`16b-REF` output. Pins in `generated-element.ref-handle.test.ts` R5 hold
the three pre-change SHA-256 values captured from the clean tree, including a
module using all FOUR older intrinsics. The seam is registered in
[`seams.md`](./seams.md), and the public delta is the one `ref` export recorded
in `docs/release/public-interface-snapshot.json`.

### Guard form

- `packages/compiler/__tests__/semantic-ir/generated-element.ref-handle.test.ts`
  — 16 Node rows: erasure (no intrinsic import or call in the emitted module),
  the retained-factory construction with exactly one construction site, reuse of
  the EXISTING channel text, the handle-only form, the pre-change SHA pins, SSR
  byte identity, depth-1 retained-child carry, aliased and `/lifecycle`-subpath
  admission, the model kind, every callback/element-form refusal, the `let`
  refusal, provenance negatives, the tracked-slot read refusal, and the
  fail-closed public import.
- `packages/compiler/__tests__/semantic-ir/generated-element.ref-handle.browser.test.ts`
  — 4 Chromium rows: mount populate → disconnect clear → reconnect repopulate
  the SAME handle object with the same retained node (and one cleanup per
  detach with cleanup-before-clear ordering); claim populate with the ADOPTED
  server node; a throwing cleanup still clearing `current`; an SSR producer that
  builds nothing and runs no notification.

**Re-run (2026-11-20, delivery-line evidence).** The two focused files were re-run
at the measured commit `f514c1290539993f9bdbeca9b02b6f99ca0a4dff` on the clean
remediation worktree (`git status --porcelain` showed only the pre-existing
`?? .cc-agent-transcript.jsonl`; every artifact output is Git-ignored):

```bash
./node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/compiler test packages/compiler/__tests__/semantic-ir/generated-element.ref-handle.test.ts packages/compiler/__tests__/semantic-ir/generated-element.ref-handle.browser.test.ts packages/compiler/__tests__/semantic-ir/generated-element.context.test.ts packages/compiler/__tests__/semantic-ir/generated-element.context.browser.test.ts
```

→ **4 files / 46 tests passed, exit 0, 5 s**; the `16b-REF` half is
**17 Node rows** (`generated-element.ref-handle.test.ts`) + **4 Chromium rows**
(`generated-element.ref-handle.browser.test.ts`) = **21 tests / 2 files**. The
2026-11-19 guard-form text above says "16 Node rows"; the re-run measures **17**
(a per-head +1 recorded here), and the older 16 stays the recorded historical
value. Provenance: `LOCAL` — a clean worktree at the cited commit;
`f514c1290539993f9bdbeca9b02b6f99ca0a4dff` (LOCAL only; no CI identity). The
later commit `434a624d39496eed70d29df4c1bba3fef17cca56` changes only one JSON
annotation and one test comment; it neither changes behavior nor is re-measured.
This is a recorded re-run, not the exit: it changes no milestone, gate or release
status, and the 2026-11-19 numbers keep their historical standing.

LOCAL evidence, single engine. Not M09 exit, not the M13 matrix, and no claim is
made here about `16b-REF` completion — every row of the migration note keeps the
state it records.

## 2026-11-19 amendment — `16b-CTX`: `provideContext` / `useContext` and the generated owner scope tree

`provideContext(token, () => value)` and `const value = useContext(token)` are the
SIXTH and SEVENTH compiler-erased intrinsics of the generated-element lane. They
are the author-facing CONTEXT capability (CAP-09). The class lane's host-side
`provideContext` / `consumeContext` pair is NOT reused as the author surface and
no second context engine is introduced: the generated lane drives the ONE
`CompiledContextService` (`compiled/runtime/context.ts`) in an additive
owner-scope mode.

### What ADR-0182 decided, and what it left open

ADR-0182 D-18b item 3 fixes the NAME PAIR and the SCOPE RULE: "`provideContext` /
`useContext` scope tree … Context is provided and consumed over the generated
owner tree, hostless owners included, with nearest-owning-component lookup,
sibling-subtree isolation and per-SSR-request isolation (the TSX-13
obligations)". It then records that "the default representation, provider
lifetime and whether context values are reactive stay OPEN and are implementation
decisions". This slice implements exactly that: the ADR's names and owner-tree
rule are followed verbatim, and the three open questions are answered below with
the tree's own semantics rather than by inventing a different API.

The ADR is PROPOSED with a blank owner sign-off, so — like `16b-EB` and
`16b-REF` — this amendment claims no capability completion, no §17.3 evidence
row and no gate/exits/release qualification.

### The shape, and the evidence that decided it

The semantic authority is
`packages/element/src/internal/compiled/runtime/context.ts`. Two facts there
decided the shape, and neither uses a new reactivity model:

1. **A provider publishes by RE-PROVIDING.** `provideContext(host, key, value)`
   disposes the previous record for the same host/key, reuses its signal and
   installs a fresh listener, so a changed value is "provide again" — that is
   the file's existing repeated-provide path. The generated lane therefore takes
   the provider's value as a VALUE THUNK (`provideContext(token, () => value)`),
   never a snapshot, and re-reads it on connect and after a declared-property
   commit.
2. **A consumer's value lives in ONE consumer-local signal.** `consumeContext`
   creates it and the service bridges it to the nearest provider. So
   `useContext(token)` returns a SIGNAL the tracked-slot machinery already
   subscribes to through `bindSignalWrites` — not a value, and not a second
   reactive system. It also means the signal object can be RETAINED (the setup
   factory builds it once), which is what makes a reconnect write into the same
   object.

So the API is:

```tsx
import { provideContext, useContext } from '@openelement/element/lifecycle';

function Inner(props: { mode: string }) {
  provideContext(Theme, () => 'inner-' + props.mode);   // a THUNK, re-read
  const theme = useContext(Theme);                       // ONE signal
  return <span>{theme.value}</span>;                     // a tracked slot
}
```

`provideContext` is a STATEMENT intrinsic (like `onConnect`), `useContext` a
declaration intrinsic (like `ref(cb?)`). The provider's second argument being a
thunk is the one signature decision the ADR left open: it is what lets "provider
changed" be the lane's existing change channel — a declared-property commit —
instead of an author `computed`, which this lane deliberately does not have.

### Ownership: the owner tree, hostless owners included

The generated lane's owners are not all elements: a component reference creates
no element, so two sibling hostless children share one element host. Anchoring
their providers on that host would leak one sibling's value into the other. The
owner-scope mode therefore gives every generated component owner a SCOPE:

| owner | scope | why |
| --- | --- | --- |
| the generated element ROOT | the element's anchor scope | a root provider must cover every depth-1 child |
| a DEPTH-1 retained hostless child | `anchor.owner()` — a CHILD of the anchor | the child's provider is invisible to its siblings, visible to its subtree, and still resolves the anchor's ancestors |
| any deeper owner | none (refused at build) | depth >= 2 retention is OWED by ADR-0181; a context intrinsic there fails closed |

A generated element's anchor finds its OWN parent through the nearest generated
ANCESTOR element (crossing shadow roots through `host`), re-resolved on every
connect, so a reconnect after a DOM move joins the right tree exactly as the
protocol consumer bridge re-resolves its provider.

### Lifetime: connect, provider change, disconnect, reconnect

| phase | what happens |
| --- | --- |
| connect | the anchor scope connects BEFORE the retained setup factory runs, because that factory is where providers register and consumers are built. Providers publish their thunk's value; consumers resolve the nearest published record into their retained signal |
| provider change | a DECLARED property commit (property write or attribute write) calls the shell's one `refreshProviders`, which re-reads every published thunk and republishes only a CHANGED value; an unchanged write notifies nobody |
| disconnect | every consumer bridge is released exactly once and every provider is marked unpublished — a disconnected scope answers nothing and observes nothing. The intents and the signals survive |
| reconnect | the scope connects again, republishes from the retained intents (re-reading the CURRENT row values), and re-resolves every consumer into the SAME signal object. No stale registration, no double registration |
| teardown | `dispose()` drops the owner tree, the provider records and the consumer bridges; a later connect creates a NEW scope ("dispose is not disconnect" applies to context too) |

### SSR: context RESOLVES AT RENDER TIME, and a consumer reader is claimable

The consumer value is resolved by the render itself, from the provider that is
already in scope. There is no second engine and no second scope tree: the
emitted `__ssr` producer drives the SAME `CompiledContextService`, in a
`forRender()` mode that is published from birth and never consults the DOM.

**The mechanism.** The render scope is a PARAMETER threaded through the
producer's own call graph, never module state:

```js
export function Root__ssr(__oe_props, __oe_host, __oe_ssrContext) {
  const __oe_contextScope =
    __oe_ssrContext === undefined ? createRenderContextScope() : __oe_ssrContext.owner();
  __oe_contextScope.provider((Theme), (() =>  props . seed));
  const theme = __oe_contextScope.use((Theme));   // written BEFORE this returns
  ...
}
```

- A MODULE-ROOT producer (called by the shadow host wrapper or the light
  serializer, both of which pass no scope) creates the render's anchor: one
  scope per producer call.
- A NESTED producer receives the CALLER's scope and joins it as `owner()` —
  byte-for-byte the same owner shape the client's retained depth-1 child setup
  emits (`anchor.owner()`), so server and client cannot disagree about who owns
  what.
- Providers publish before consumers resolve in both phases, so a component that
  provides and consumes reads its OWN value. `CompiledContextService.use()`
  writes the nearest published value synchronously in render mode, then falls
  back to the context's declared default.

**Per-render isolation (TSX-13's third obligation) is now delivered, not
vacuous.** The state lives in a function parameter and a per-call object, so two
concurrent renders cannot observe each other. There is no module-level "current
render", no global registry and no server-side scope tree. Node row C18 renders
the same module twice with different provider values in one tick (and interleaves
two hand-built scopes) and each reads only its own.

**The claim discipline.** Lifting the decline means the existing gate now emits
BOTH artifacts for a consumer-reading component: `<Name>__ssr` carries the
resolved value as ordinary escaped text inside the lane's existing text-slot
markers, and `<Name>__claim` walks those markers with the unchanged static-seed
checks. Because the server and the client resolve from one rule over one provider
tree, a matching claim writes nothing — Chromium row X5 counts DOM mutations
during the claim of the producer's own bytes and requires ZERO. X6 then writes a
declared property and requires the consumer to follow, so a claim that merely
retained the server text without a live connection would fail.

**Fail-closed boundary, stated precisely.** A `Context` token cannot exist
without a default: `createContext(key, defaultValue)` requires one, and the
type carries it (`Context<T>.defaultValue`). "Consumer with no resolvable
provider and no declared default" is therefore not a representable state, so the
render path has no case to diagnose and the declared default is the lawful
answer — the same answer the client engine gives. Node row C17 pins it. What
*is* refused, at the authored span with the existing identities: a context
intrinsic at depth ≥ 2 or in a recipe/list body (`OEIR_LEAF_INVALID_ARTIFACT`,
unchanged), and a provider thunk reading a host binding
(`OEIR_GENERATED_ELEMENT_UNBOUND_BINDING`, unchanged).

**Remaining limitation.** `useContext` still returns a SIGNAL, and the server
resolves it ONCE per producer call: a server render has no later write, so no
server-side reactivity is claimed (there is nothing to react to before the bytes
leave). A consumer value that changes during the same render — for example from
a provider thunk that reads a mutable external — is therefore read at its
declaration point, not re-read before serialization.

A second, narrower limit: a component whose tree is FULLY STATIC keeps its
parameterless `<Name>__ssr()` and therefore registers no server-side provider
even when it calls `provideContext`. That is unobservable by construction — a
static producer admits no dynamic-text slot (so no consumer read) and no
component reference or insertion site (so nothing in its rendered subtree can
resolve its provider) — and a sibling reference could not see it anyway, on
either phase. Measured: `probe-static` emits `export function Static__ssr()` and
no `createRenderContextScope` import. A depth >= 2 owner tree is still OWED by
ADR-0181 and still refused.

### What is NOT claimed

- No server-side **provider** transport: nothing seeds a provider value from the
  wire. The server value is computed by the same provider thunks the client
  runs, from the same props the render was given; a provider whose value would
  have to come from a client-only channel still fails closed (host-binding thunk)
  or renders from its authored expression.
- No server-side **reactivity**: a render resolves each consumer once. Nothing is
  re-read between resolution and serialization.
- No component ref, no `useHost`, no `computed`: unchanged from the other slice
  records.
- No depth >= 2 owner tree: a context intrinsic in a non-retained target, a
  recipe/list body or a depth-2 component fails closed at the authored span.
- No provider `computed`-style laziness, and no `useContext` outside a component
  body.
- No change to the class lane: the host-side `provideContext(host, context,
  value)` / `consumeContext` pair, `CompiledContextService`'s protocol path and
  every existing kernel call keep their behaviour; the owner-scope and
  render-mode methods are additive, share the service's consumer set,
  subscription map and exactly-once disconnect release, and the render mode
  cannot reach the protocol path at all (its element is `null` by construction).

### Bytes

A module that does not use either intrinsic is byte-identical to its
pre-`16b-CTX` output. The `16b-REF` SHA-256 pins in
`generated-element.context.test.ts` C6 hold for the four-intrinsics, plain and
local fixtures, and the whole pre-existing compiler suite passes unchanged.

A module that DOES use an intrinsic gains exactly the lines its phase needs: the
retained-factory scope/provider/consumer in the client body, and (new here) a
scope declaration plus the provider/consumer pair in the producer body. A
producer that neither provides, consumes nor references a context user gains
nothing — not even the `createRenderContextScope` import, which is registered by
the same body-text predicate every other optional runtime symbol uses.

### Guard form

- `packages/compiler/__tests__/semantic-ir/generated-element.context.test.ts` —
  19 Node rows: erasure (no intrinsic import or call in the emitted module), the
  retained-factory construction with exactly one construction site per PHASE, the
  THUNK-not-snapshot rule, the existing `bindSignalWrites` subscription channel,
  a nested owner's `owner()` child scope in both phases, the pre-change SHA pins,
  the claimable-and-serializable consumer reader with its scope parameter, the
  depth-1 retained consumer, aliased and `/lifecycle`-subpath admission, the model
  kind, every call-shape refusal, provenance negatives, the depth>=2 placement
  refusal, the fail-closed public import, the existing `UNBOUND_BINDING` gate for
  a provider thunk reading a host binding, and the four SERVER rows: the provided
  value in the bytes with nested shadowing and sibling isolation (C16), the
  declared default with no provider (C17), per-call isolation across concurrent
  renders (C18), and the scope parameter joined as `owner()` (C19).
- `packages/compiler/__tests__/semantic-ir/generated-element.context.browser.test.ts`
  — 6 Chromium rows: nested shadowing with sibling-owner isolation (TSX-13);
  provider update on a property write and on an attribute write with an
  unchanged write notifying nobody; disconnect cleanup (a detached provider
  reads nothing); reconnect re-registration (republishes from the retained
  intent with the CURRENT value, exactly one registration, a live connection
  afterwards); the SSR→claim vertical (the producer's own bytes carry the
  provided value and the claim of those bytes mutates nothing, X5); and the
  claimed value staying the rendered one while the connection stays live (X6).
- `packages/element/__tests__/compiled-runtime/context.test.ts` — 9 additive
  rows for the engine itself: nearest owner-scope provider, sibling isolation,
  the declared default, disconnect/reconnect without duplicates, the
  changed-value-only republish with the service-disposed identity, plus four
  RENDER-mode rows: synchronous provided-value resolution, nearest-first
  shadowing with `owner()` and sibling isolation, two-scope independence, and the
  default answer with no protocol request installed.

**Re-run (2026-11-20, delivery-line evidence).** The two `16b-CTX` focused files
were re-run in the same command as the `16b-REF` re-run (recorded in that
section), at the measured commit `f514c1290539993f9bdbeca9b02b6f99ca0a4dff` on
the clean remediation worktree:

```bash
./node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/compiler test packages/compiler/__tests__/semantic-ir/generated-element.ref-handle.test.ts packages/compiler/__tests__/semantic-ir/generated-element.ref-handle.browser.test.ts packages/compiler/__tests__/semantic-ir/generated-element.context.test.ts packages/compiler/__tests__/semantic-ir/generated-element.context.browser.test.ts
```

→ **4 files / 46 tests passed, exit 0, 5 s**; the `16b-CTX` half is
`generated-element.context.test.ts` **19 tests** + `generated-element.context.browser.test.ts`
**6 tests** = **25 tests / 2 files** — matching the "19 Node rows + 6 Chromium
rows" guard form above. The 9 additive rows in
`packages/element/__tests__/compiled-runtime/context.test.ts` were **not** run as
a separate focused command by this re-run (the run covered the two compiler-project
files); they are inside the `@openelement/element` suite that passed at the same
commit (132 files / 1036 tests), which is suite-level coverage, not a focused
substitute. Provenance: `LOCAL` — a clean worktree at the cited commit;
`f514c1290539993f9bdbeca9b02b6f99ca0a4dff` (LOCAL only; no CI identity). This is
a recorded re-run, not the exit: it changes no milestone, gate or release status.

LOCAL evidence, single engine. Not M09 exit, not the M13 matrix, and no claim is
made here about `16b-CTX` completion — every row of the migration note keeps the
state it records.

## 2026-11-20 later reading — lifecycle author guidance for the generated lane (documentation only)

This is an append-only author-guidance note; it changes no export, no compiler
admission, no bytes and no status. It is the documentation half of the
2026-11-20 remediation (the code-side JSDoc is
`packages/element/src/lifecycle.ts`; the decisions are the ADR-0182 amendments
of the same date).

- **Import the generated-lane intrinsics** (`onConnect`, `onDispose`,
  `provideContext`, `useContext`, `onError`, `ref`) as named imports from the
  package root, or — on a page that must not reach the element executor — from
  `@openelement/element/lifecycle`. They are compiler-erased at the authored
  site; the import path does not add a runtime dispatcher.
- **`onError` is exported only from the root entry.** `@openelement/element/lifecycle`
  does not re-export it, so a generated component that needs the 16b-EB boundary
  imports `onError` from `@openelement/element` (the root entry's
  sideEffects keep the executor in the graph). This is a recorded known
  P1-budget trade-off, not a bug: no production consumer in the tree uses
  `onError` today, and adding the re-export is a public-surface decision, not a
  migration side effect.
- **`provideContext` has two different meanings by import path.** The root
  entry's `provideContext(host, context, value)` is the class-lane host-side
  helper; `@openelement/element/lifecycle`'s `provideContext(context, read)` is
  the generated-lane intrinsic. They are distinct functions that share one
  exported name; TypeScript disambiguates them by import path, but the compiler
  admits both spellings, so there is no compile-time diagnostic for a
  wrong-signature use. ACCEPTED ambiguity (ADR-0182 2026-11-20 amendment):
  authors of generated components use the `/lifecycle` form for the generated
  lane and never the root three-argument host form inside a compiled setup.
- **`useHost` is FUTURE/OWED.** It is listed in ADR-0182 D-18b-4 and execution
  plan §17.1 but not implemented; `env.host` is the only delivered host access.

## 2026-11-20 amendment note — one props record, and where `computed` stands

Two facts replace the 2026-11-18 ruling's premise; the ruling's text stays above
as history (amend-never-rewrite).

1. **One props record.** The generated-element shell no longer carries a second
   props record. `createTrackedProps` (`internal/compiled/runtime/props.ts`) is
   the one owner; its getters read one version signal, so a read inside an
   effect tracks; the shell's `Map` + plain getters + hand-written
   `propsChanged` counter are deleted (the emitted ABI name `propsChanged` now
   names the primitive's version signal). Guard:
   `packages/element/__tests__/compiled-server/shell-props-single-owner.test.ts`
   plus the seam row in `seams.md`. Record: ADR-0183 D-5.
2. **`computed` is admitted and lowered; it is blocked on the binding source,
   not on reactivity.** `OEIR_GENERATED_ELEMENT_UNBOUND_BINDING` still refuses a
   module whose root requires host bindings (`signal`/`computed`), because no
   production bindings source exists on the generated root yet. Pinned by
   `packages/compiler/__tests__/semantic-ir/generated-element.computed-boundary.test.ts`.
   Migrating a component with `computed` therefore stays blocked until that
   source lands (ADR-0183 D-4 slice), and inlining to work around it is still
   refused as a migration shape.

The migration rule for authors is unchanged in the meantime: a component that
needs derived state waits for D-4; a component that only reads its rows migrates
now.

## 2026-11-20 amendment — client-only shadow styles land; a silent hook drop is fixed (facts only)

This closes the last row the 2026-11-15/2026-11-16 style amendments left OWED.
It rewrites nothing above; the OWED text stays as history.

**The measured gap.** The generated lane replaced the class lane's
`import sheet from './x.css'` + `static styles = [sheet]` with the sidecar STRING
list `styles: ['./x.css']`. That list is build metadata: the scan turns it into
an emitted asset plus (for SSR) a DSD `<link>`, and it produces no module-graph
edge. An `ssr: false` shadow island has no DSD template and its root is created
by the browser, so nothing delivered the sheet and the island rendered completely
unstyled. Measured on an emitted island module: `has css import: false`,
`styleLinks` present (server-only), no descriptor `styles` key.

**The delivery (three parts, one fact).**

1. The sidecar reader exposes the client-only phase as `clientOnly`: explicit
   `ssr: false` or `hydrate: 'only'` (the same `resolveIslandSsrDsd` coercion the
   router scanner applies). `ssr: true`/absent stay the SSR case. A dynamic or
   duplicate `ssr` refuses with `OEIR_GENERATED_ELEMENT_SSR_INVALID`.
2. For a client-only island with declared styles, the emitter writes one real
   `import sheetN from '<specifier>';` per specifier and a descriptor
   `styles: [sheetN, …]` row. The identifiers join the tail collision list. An
   SSR island changes no byte. If a client-only island declares styles but no
   static specifier reaches the emitter, the build fails closed with
   `OEIR_GENERATED_ELEMENT_CLIENT_STYLES_UNWIRED` — an unstyled render is never
   silent.
3. The generated-element shell carries the row, validates every entry is a real
   sheet object (`replaceSync` callable; no `cssRules` read, so the Firefox
   still-loading race stays closed), and adopts through the class lane's SAME
   `CompiledStyleScope` into the root it created. It releases on disconnect and
   re-adopts on reconnect; an adopted DSD root (a marked link already in its
   template) is never a target, and a light root adopts into its containing tree.

**Scan admission follows the same fact.** A `missing-producer` shadow island used
to be refused because there was no template and no client adoption channel. It
stays refused for a server-rendered island; it is now ADMITTED when the island is
client-only, because the emitted import plus the shell adoption is a complete
delivery. `OE_ISLAND_STYLE_SHADOW_UNWIRED` therefore names exactly the
server-rendered no-producer case.

**The path is proven three ways locally.** A Node row set compiles the emitted
bytes (`generated-element.client-styles.test.ts`, 12 rows). The real Router CLI
build in `island-style-build.test.ts` shows the client-only island's chunk
carrying the ONE content-addressed asset URL the manifest records (the test that
used to pin "zero JS bytes" now pins the intended import instead — the old
premise was only true while the island rendered unstyled). The element-browser
suite compiles a `ssr: false` fixture through the lane and asserts the host's
COMPUTED `display` is `inline-block` from `:host{display:inline-block}`.

**Prerequisite defect fixed on the way (same slice, measured).** An
`onConnect`/`onDispose` callback that read a root `signal`/`computed` was
classified as a host-binding read and dropped SILENTLY: no diagnostic, no emitted
hook, a green build and dead author code. ADR-0183 D-4 makes those resources the
retained factory's own declarations, so the hook reads them as sibling closure
captures. `generated-element.imports.test.ts` and the A11 row now assert the
emitted callback, not just the signal declaration. The target `live-timer`
template needs this combination (a ticking `signal` written from `onConnect`).

**Not claimed.** No CI evidence (this line has none), no M12/M13/M14, no P5
sign-off, no lane deletion. The nested-light-root-inside-a-shadow-template case
stays a written rule, not a capability (see §"Two gaps that are NOT the same
thing" in the handoff and the migration matrix).

## 2026-11-21 amendment — `16b-LC` depth >= 2 lands: the cross-ledger transaction (facts only)

This closes the "depth ≥ 2 OWED behind a cross-ledger transaction protocol" reading
that the 2026-11-15/16 amendments recorded. It rewrites nothing above; the OWED
text stays as history and this is the current state.

**The protocol (runtime).** `beginInstancePass(owner)` now returns an
`InstanceTransaction` token. A retained body that itself retains children calls
`joinInstancePass(ownScope, token)`: it opens a NORMAL pass on its own ledger and
registers as a member; it never commits or aborts. The root's `endInstancePass`
commits the root pass first and then every surviving member (shallow-first, and a
member whose ledger was released or whose pass number moved is skipped — the
idempotent form of "its subtree is already gone"); `abortInstancePass` aborts
members deepest-first and then the root pass, so an attempt that never happened
leaves pre-existing entries intact with their previous structural index. Evicting
ANY entry first releases that scope's own ledger, so grandchild bookkeeping can
never outlive its owner, and an explicit owner teardown closes a live
transaction's member passes before deleting the ledger. Failure identities grow by
the same two internal codes the depth-1 slice already used (`STATE` for a
mis-ordered bracket, `DISPOSED` for a joined owner that went away); a joined pass
cannot be ended/aborted by its child body, and a closed token cannot be joined.

**The emission (compiler).** The eligibility plan is the same monotone fixpoint
with one more owner class: a site is retention-eligible when its owner EMITS
retain calls (the root, or a retained component that itself retains children).
`RetentionPlan` gains `retainingBodies` and `transaction`. A retaining body emits
`const __oe_txn = beginInstancePass(host.instance)`; a retained retaining body
emits `const __oe_txn = host.txn; if (__oe_txn !== undefined) joinInstancePass(
host.instance, __oe_txn);`. The token travels in the compiler-private child host
literal (`txn:`), emitted only for targets that retain children, so a depth-1
module keeps exactly its pre-change bytes and graph.

**What is proven (LOCAL Chromium + Node; measured commit `6fc34e713`).** Chromium `R8`: retained grandchild
across a reconnect (both setups stay 1, the retained snapshot renders instead of
the live prop). `R10`: a failed reconnect claim aborts the attempt, commits no
child pass, surfaces exactly one `OEIR_LEAF_CLAIM_MISMATCH` and converges with
both records intact. `R11`: `dispose(true)` releases the whole subtree once and a
later connect re-runs BOTH setups on a new instance. Node artifact rows:
`nested-instance-wiring.artifact.test.ts` (depth-2 site counts, no child bracket,
one join per retaining child body) and `instance-ledger.test.ts` (40 rows, five of
them the transaction). Suites: compiler 102 files / 1421 tests, element 136 /
1063.

**What this does NOT claim.** No §4.1d subtree contract, no recipe/list placement
retention (still refused), no keep-alive, no scope-identity promise, no
M12/M13/M14 or P5 evidence. The milestone-level exit claims stay where the
closeout puts them.

## 2026-11-21 amendment — the generated lane replays pre-hydration interactions (facts only)

The generated lane captured a pre-hydration click (the entry installs
`ensurePreHydrationClickCapture` through `document-services`) but never replayed
it: the replay pair lived in `pre-upgrade-events.ts`, which the generated shell's
P1 closure test lists among the old-backend modules the emitted bundle must not
reach. Measured on the packed starter: `#942 click before idle hydration is
replayed` and `third-party pressure does not block idle replay` were RED on
chromium, firefox and webkit.

**Delivery.** A new import-free module,
`internal/compiled/runtime/pre-upgrade-replay-hook.ts`, holds one function slot.
The capture module publishes its own `replay`/`release` pair into that slot when
`ensurePreHydrationClickCapture` installs (the call the generated entry already
makes), and the shell calls `replayPreUpgradeCaptures(this)` after a successful
claim/mount and `releasePreUpgradeCapturesFor(this)` in the connect `finally` —
the same two points the class facade uses. The hook's functions ARE the
registry's, so there is one bucket map, one capture and one implementation; a
page that never installs the capture keeps a null hook and both shell calls are
honest no-ops.

**Rejected shapes (measured).** (1) Importing the capture module from the shell
fails the P1 closure row immediately. (2) Splitting the bucket registry into a
separate module the shell imports was implemented and REVERTED: the capture
module's `CompileHydrationOptions` type import becomes a value edge under a real
bundler, so the split dragged the old backend in and the same row went red.

**Evidence (LOCAL).** Packed starter `pnpm --dir tests/e2e/starter-smoke run
test`: **33 passed (33)** across chromium, firefox and webkit, including both
previously-red rows and the client-only computed-style row. Unit:
`pre-upgrade-retention.test.ts` (4 rows, one for the hook). The shell's P1 closure
row (26 tests) still passes.

**Not claimed.** No M12/M13/M14 or P5 evidence; the hook is not a second capture
or a second registry, and no new public symbol exists (the module is
internal-only and reaches nothing).
