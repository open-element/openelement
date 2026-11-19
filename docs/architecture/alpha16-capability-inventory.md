---
status: active
topic: Alpha16 capability inventory (P5 evidence)
summary: The tracked capability inventory §13.5 requires — what the retiring class path provided, what replaces it on the generated path, and each replacement's state. Not a sign-off; P5 stays unclaimable until the owner signs; the final-SHA matrix/verdict rows are re-recorded in the 2026-11-20 remediation.
---

# Alpha16 capability inventory

The tracked capability inventory §13.5 requires for P5: what the retiring class
authoring path provided, what replaces it on the generated path, and the state of
each replacement at a named SHA. The final-SHA matrix is the `class authoring`
column beside the `generated lane` column — a capability counts as MIGRATED only
when both columns describe a working surface, never when only the replacement
exists.

**Status of this document.** It is tracked and reproducible; it is **not** a
sign-off. §13.5 requires four things — this inventory, the final-SHA matrix, the
migration note and the owner sign-off — and the signature is the owner's to give.
Until it is given, P5 is not claimable and Alpha16 release qualification is not
openable. Nothing below should be read as a release claim.

**Re-record note (2026-11-20).** The final-SHA matrix and the verdict rows are
re-recorded in the 2026-11-20 remediation (see the `p1-applicability-record`
re-record and the `Final-SHA matrix (2026-11-20)` section below); this file
carries the mechanisms and the capability states, and the verdict paragraph
below carries the 2026-11-20 corrections to the 2026-11-19 reading. The
2026-11-19 revision's header anchor `Verdict at c9dcf660f` and the slice-index
anchors `e8ea72b95`/`d135576d0` are history, kept with their recorded values:
they are not on the delivery line and are not the delivery-line record. The
measured re-record is at
`f514c1290539993f9bdbeca9b02b6f99ca0a4dff` (the later commit
`434a624d39496eed70d29df4c1bba3fef17cca56` changes only one JSON annotation and
one test comment; it neither changes behavior nor is re-measured).

**Evidence rule.** Every row cites the mechanism by file and the acceptance by
test name, and the numbers are per-SHA. A capability is `MIGRATED` when the
generated lane delivers the same SEMANTICS (not merely a same-named export), with
the parenthesised note naming what the class path did that the generated path now
does differently or refuses.

**Verdict (2026-11-19; corrected 2026-11-20).** Four capabilities have a full
replacement: lifecycle (root scope, extended by the depth-1 nested/hostless
hooks and the connection-scope `env` helper), context, refs and the
per-component property/attribute channel. The error boundary is **PARTIAL /
OWED-ALPHA17**: the capture points are delivered (connect/claim, plus
update/refresh and event dispatch sharing the existing `guardUpdate` sink) and
the SSR fallback is deferred to Alpha17 by the owner-approved plan amendment
(`alpha16-18-execution-plan.md` §18.3), so the row is not a full replacement.
Form participation is PARTIAL: the bounded mechanism is delivered and its
non-claims are recorded. `useHost` is FUTURE/OWED. Everything listed under
"Still owed" is genuinely unfinished, not deferred paperwork. The final-SHA
matrix and the verdict rows are re-recorded in the 2026-11-20 remediation (see
the `p1-applicability-record` re-record); this file asserts no new numbers.

## Slice index (§13.2 obligation → row)

§13.2 names five Alpha16b obligation slices. The rows above are organised by
capability, so this index maps each slice ID to the rows that satisfy it — a
reader holding the plan should not have to infer the correspondence.

| Slice | Capability | Rows in this document | State |
| --- | --- | --- | --- |
| `16b-LC` | Class lifecycle (CAP-03) | author lifecycle: connect / disconnect / property change | **PARTIAL** — root scope delivered; depth-1 nested/hostless hooks and the connection-scope `env` helper are delivered (migration note 2026-11-16 amendments), while depth ≥ 2, recipe/list placement, non-retained targets and pre-DOM timing remain in "Still owed" |
| `16b-EB` | Error boundary (CAP-05) | error boundary | **PARTIAL / OWED-ALPHA17** — capture points delivered (2: connect/claim; update/refresh + event dispatch share one `guardUpdate` sink); **no SSR fallback** — deferred to Alpha17 (execution plan §18.3), so not MIGRATED (corrected 2026-11-20) |
| `16b-CTX` | Context (CAP-09) | context provider / consumer | **MIGRATED** (2026-11-19 anchor `e8ea72b95`, kept as history — off the delivery line; delivery-line row in the final-SHA matrix below) |
| `16b-REF` | Refs (CAP-11) | node refs | **MIGRATED** (2026-11-19 anchor `d135576d0`, kept as history — off the delivery line; delivery-line row in the final-SHA matrix below) |
| `16b-MN` | Migration note (CAP-26) | this document plus `16b-migration-note.md` | **TRACKED** — both are tracked and indexed; the owner sign-off is the remaining §13.5 item |

## Capability map

| Capability | Class authoring (retiring) | Generated lane (replacement) | State |
| --- | --- | --- | --- |
| Component declaration | `@element('tag')` + `class X extends OpenElement` | local default-exported function + `defineIslandConfig`/`defineComponentConfig` sidecar (`root`, `tag`, `properties`) | **MIGRATED** — the compiler emits the `OpenElementBase` subclass; island admission refuses a re-export default (`lane-declined / compiler-declined`) so the body must live in the admitted module |
| Reactive render | `render()` returning compiled JSX | function component returning compiled JSX; every sink is a compiled slot | **MIGRATED** (depends on emission: a value bound to a local identifier yields ZERO refreshes while the same expression inlined yields two — R1b, pinned by a regression test) |
| Derived values | `computed(() => …)` | none — values are inlined at each sink | **DELIBERATELY ABSENT** (a computed closure cannot track the shell's coarse `propsChanged`, so it would go permanently stale; adding it is a new capability, not a port) |
| Property / attribute channel | `@property({ reflect, attribute })` | `properties` row in the sidecar: `{ reflect, attribute, default }` | **MIGRATED** — primitive rows convert through the same `convertFromAttribute`/`coercePropertyValue` leaves |
| Non-primitive property wire | runtime property assignment on the instance | `data-oe-prop-seed` host attribute carrying JSON (ADR-0182 D-18c), consumed once by `applyGeneratedPropSeed` | **MIGRATED** — `array`/`object` only; `trustedHtml` is excluded because the brand is object identity in a `WeakSet` and any wire transfer would re-forge trust from bytes |
| Author lifecycle: connect | `connectedCallback()` | `onConnect(env)` intrinsic, erased by the compiler into the claim/mount prologue | **MIGRATED** (runs BEFORE the generated region exists — a handler that scans the rendered subtree must defer one macrotask) |
| Author lifecycle: disconnect | `disconnectedCallback()` | `onDispose(env)` plus the connection-scope `abort` signal | **MIGRATED** (a disconnect keeps the generated DOM, LC-0, so a teardown that wrote state must restore the declared seed or the next claim fails) |
| Author lifecycle: property change | `attributeChangedCallback` / property setter | `onPropertyChange({ host, signal, states, name, value })` | **MIGRATED** |
| Error boundary | static `isErrorBoundary` + `catchError()` | `onError(env)` with the shell's capture points (connect/claim; update/refresh and event dispatch share the existing `guardUpdate` sink); **no SSR fallback** — deferred to Alpha17 (execution plan §18.3) | **PARTIAL / OWED-ALPHA17** — the capture points are delivered, but the SSR fallback is a named Alpha17 carry, so the row is not MIGRATED; no handler registered keeps the pre-existing rollback-then-rethrow byte-identically (corrected 2026-11-20) |
| Context provider / consumer | `provideContext(host, token, value)` + subscription | `provideContext(token, () => value)` / `useContext(token)` over the generated owner tree, hostless owners included | **MIGRATED** (`e8ea72b95`) — nested providers shadow, sibling subtrees are isolated, a declared-property commit re-reads the thunk, reconnect republishes from retained intents, and a consumer-reading component IS server-renderable (the scope rides the producer argument list, so per-render isolation is structural) |
| Node refs | `@query`/manual `querySelector` in `connectedCallback` | `ref(cb?)` declaration intrinsic handed to the existing `ref` JSX channel; `current` survives mount/claim/reconnect | **MIGRATED** (`d135576d0`) — no second attachment mechanism; `current` is deliberately not reactive (a tracked-slot read is refused with `OEC9042`) |
| Form participation | `static formAssociated` + `ElementInternals` access | sidecar `formAssociated` + the shell's form controller; value/required/disabled with `required → valueMissing` | **PARTIAL** (`fa6e5232d`) — the slice declares a "host access gap" non-claim and does not reach full `open-input` parity; full constraint mirroring (type/email, minlength) is a deferred sub-obligation, not an exception |
| Slots / light DOM | `static styles`, `<slot>` in the template | compiler-emitted slot anchors (`oe:s:<ordinal>:<hex>`) plus the light-root producer; `projectedChildren` substitution walks comment tokens only | **MIGRATED** |
| Styles | `static styles = css\`…\`` | file-based `.oe-style.css` imports (the string-template tag retired with #1558) | **MIGRATED** — one delivery shape; the generated root joins the same `themeManager` broadcaster |
| Registration / packaging | `customElements.define` at module scope | compiler-emitted Native Custom Element tail + `generated-manifest.json` / `custom-elements.json` | **MIGRATED** |

## Generated-only capabilities (no class counterpart)

These exist BECAUSE the generated lane is a different execution model. They are
not ports and have no retiring counterpart.

| Capability | Mechanism | Note |
| --- | --- | --- |
| Executor-free page floor | `@openelement/element/document-services` + the narrow `leaf-runtime` entry | A page whose islands are all generated-lane emits no `element-services` loader, so the document-level services need a surface that reaches no executor module |
| Claim verification | `assertStaticAttributeSeed` + `assertGeneratedRootOptions` | A runtime write onto a claimed static attribute fails with `OEIR_LEAF_CLAIM_MISMATCH` rather than silently diverging from the rendered bytes |
| JSON prop seed | `data-oe-prop-seed` (ADR-0182 D-18c) | The one channel a non-primitive declared row crosses SSR→claim on |

## Still owed (stated, not deferred as paperwork)

| Item | Why it is open |
| --- | --- |
| `16b-LC` depth ≥ 2 nested hooks, recipe/list placement and pre-DOM timing | Root lifecycle, depth-1 nested/hostless hooks and the connection-scope `env` helper are delivered (migration note 2026-11-16 amendments); the remaining placements are still refused (`OEIR_LEAF_INVALID_ARTIFACT` / `OEC9041`), so the slice stays PARTIAL. |
| `16b-EB` SSR fallback | Deferred to Alpha17 as a named carry by the owner-approved plan amendment (`alpha16-18-execution-plan.md` §18.3) — not a §13.3 exception and not delivered by the capture points. |
| `useHost` host-element accessor (D-17b) | **FUTURE/OWED** — listed in ADR-0182 D-18b-4 and execution plan §17.1, not implemented; the migration note's 16b-REF record says "No `useHost`-style host accessor (a separate D-17b item)". It is not part of the experience edition's delivered surface, and the 2026-11-20 remediation records the status without implementing it; `env.host` remains the only delivered host access. |
| Depth ≥ 2 generated owner tree | Refused with `OEIR_LEAF_INVALID_ARTIFACT`; ADR-0181 owns depth-1 retention and has not extended it. |
| Form constraint mirroring | The bounded mechanism covers `required → valueMissing`; type/email/minlength and the full input parity are a named deferred sub-obligation. |
| Reactive refs and component refs | `ref.current` is not reactive by design (a tracked read is refused), and component (non-element) refs stay out of scope per ADR-0182 D-18b-5. |
| Server-side context reactivity | A consumer value resolves once per producer call. There is nothing to react to before bytes leave, so this is a property of SSR rather than a gap — recorded so a future reader does not read it as one. |

## How a reader verifies a row

Each `MIGRATED` row names a mechanism by file and an acceptance by test. To
re-check one at a candidate SHA:

```sh
vp run --no-cache --fail-if-no-match --filter @openelement/compiler test
vp run --no-cache --fail-if-no-match --filter @openelement/element test
vp run --no-cache --fail-if-no-match --filter @openelement/router test
node tools/repo/check-browser-entry-graph.ts www/dist/client/.vite/oe-browser-entry-graph.json
```

The last command is the P1 evidence; the three suites carry the capability tests.
A row that cannot be reproduced from these commands is a defect in this document.

## Final-SHA matrix (2026-11-20)

The §13.5 final-SHA matrix, recorded at the measured commit
`f514c1290539993f9bdbeca9b02b6f99ca0a4dff`. A slice counts as `MIGRATED` only
when both the class-authoring and generated-lane columns describe a working
surface (never when only the replacement exists). No row here is a sign-off and
no row is an exit.

Five-field record shared by every row below (the per-row command and result are
in the table):

- **commit:** `f514c1290539993f9bdbeca9b02b6f99ca0a4dff` — HEAD did not move
  across the measurement run. The later commit
  `434a624d39496eed70d29df4c1bba3fef17cca56` changes only one JSON annotation and
  one test comment; it neither changes behavior nor is re-measured.
- **status:** clean at measurement — `git status --porcelain` showed only the
  pre-existing `?? .cc-agent-transcript.jsonl`; every artifact used is
  Git-ignored.
- **provenance:** `LOCAL /private/tmp/oe-a16-closure-B` at the cited commit — a
  LOCAL record only, not a CI run/job; it writes no CI column.
- **environment:** macOS (darwin), 8 cores / 16 GB; Node `v24.18.0`; pnpm
  `12.8.1`; Playwright `1.59.1` (chromium `147.0.7727.15`, firefox `148.0.2`,
  webkit `26.4`).
- **full log:** `.artifacts/pr1804-remediation-20261120/02-evidence/EVIDENCE-RUN.md`.

| §13.2 slice | state | command → result at the measured commit |
| --- | --- | --- |
| `16b-LC` | **PARTIAL** — root author lifecycle, depth-1 nested/hostless hooks and the connection-scope `env` helper delivered; depth ≥ 2, recipe/list placement, non-retained targets and pre-DOM timing stay owed | `./node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/compiler test` → **95 files / 1386 tests passed**, exit 0, 91.83 s; the same measurement session: `./node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/element test` → **132 files / 1036 tests passed**, exit 0, 43.18 s. **No focused LC command was re-run**, so this row's evidence is the full compiler/element suite pass plus the capability-state record above — suite-level exercise of the delivered paths, not a focused LC record |
| `16b-EB` | **PARTIAL / OWED-ALPHA17** — capture points only (2: the connect/claim pass; update/refresh and event dispatch share one `guardUpdate` sink); **no SSR fallback** — deferred to Alpha17 by the owner-approved plan amendment §18.3 (a named carry, not a §13.3 exception), so the slice is not MIGRATED | `./node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/compiler test` → **95 files / 1386 tests passed**, exit 0, 91.83 s; **no focused EB command was re-run**, so this is suite-level exercise, not a focused EB record. The SSR fallback is not delivered and is not claimed |
| `16b-CTX` | **MIGRATED** (delivery-line record; the slice-index anchor `e8ea72b95` is historical) | `./node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/compiler test packages/compiler/__tests__/semantic-ir/generated-element.ref-handle.test.ts packages/compiler/__tests__/semantic-ir/generated-element.ref-handle.browser.test.ts packages/compiler/__tests__/semantic-ir/generated-element.context.test.ts packages/compiler/__tests__/semantic-ir/generated-element.context.browser.test.ts` → **4 files / 46 tests passed, exit 0, 5 s**. The CTX half is `generated-element.context.test.ts` **19 tests** + `generated-element.context.browser.test.ts` **6 tests** = **25 tests / 2 files** |
| `16b-REF` | **MIGRATED** (delivery-line record; the slice-index anchor `d135576d0` is historical) | Same command → **4 files / 46 tests passed, exit 0, 5 s**. The REF half is `generated-element.ref-handle.test.ts` **17 Node tests** + `generated-element.ref-handle.browser.test.ts` **4 Chromium tests** = **21 tests / 2 files**; the 2026-11-19 record's 16 Node rows is that head's per-head value and stays historical |
| `16b-MN` | **TRACKED** — this inventory plus `16b-migration-note.md` are tracked and indexed; the owner sign-off is the remaining §13.5 item | `./node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/tools-repo docs-index:check` → `docs-index:check: current view is generated, links resolve (44 active document(s), 8 historical record(s), 15 archive/removal entr(ies)).`; `./node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/tools-repo adr-index:check` → `adr-index:check: 42 record(s), 42/42 entr(ies) resolved, 15 annotated — every record listed once and every annotation agrees with its record.`; `./node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/tools-repo shims:check` → `shims:check: 27 shim(s) / 5 retired — every location tracked, every row owned with a retirement condition, 20 line citation(s) in range.`; all exit 0. Per-head gate deltas vs the 2026-11-19 audit at `07963b738` (old values kept as historical): adr-index annotated **13 → 15**, shims **26 → 27** (Wave 1/3 document commits) |

## Owner sign-off (2026-11-20, delegated remediation session)

**What this section records.** The owner (SisyphusZheng) authorized the remediation
team in the 2026-11-20 session — verbatim "全全交给你负责，启动团队把这些任务全部解决掉"
— to carry out the PR #1804 remediation under delegation
(`alpha16-18-execution-plan.md` §18, record form §18.7). Under that delegated
authority, this section records that the P5 evidence set — this inventory, the
`Final-SHA matrix (2026-11-20)` above and `16b-migration-note.md` — was compiled
and checked by the delegated remediation session. It is recorded **by the
remediation team (recorder), not by the owner**, and it is **not a personal
written signature**; every "owner-approved 2026-11-20" in this file means that
in-session delegation.

**What is not recorded, and not claimable.** §13.5's owner sign-off on the
final-SHA matrix is a personal signature and is **not given** here and cannot be
given by the delegation: plan §18.7 says a §13.5 owner sign-off needs the owner's
own line, and plan §18.6 item 3 assigns the P5 final-SHA matrix together with the
owner's own sign-off to an independent consolidation PR. Until that lands, **the
§13.5 P5 evidence stays unsigned and P5 is not claimable; Alpha16 release
qualification is not openable** (see "Status of this document" above). This
section creates no milestone, gate, exit or release claim.
