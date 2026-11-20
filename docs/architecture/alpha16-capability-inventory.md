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

**Verdict (2026-11-19; corrected 2026-11-20 and 2026-11-21).** Five capabilities
have a full replacement: lifecycle (root scope, nested hostless hooks at any
depth after the 2026-11-21 cross-ledger transaction, and the connection-scope
`env` helper), context, refs, the per-component property/attribute channel and
the client-only style channel. The error boundary is **PARTIAL BY DESIGN**: the
capture points (connect/claim, plus update/refresh and event dispatch sharing the
existing `guardUpdate` sink) and the §19.2 SSR fallback conditions 1–4 are all
delivered; only a NEW identity for the fallback bytes is out of scope, so the
row is not flipped. No item is deferred to a later milestone any more — the
Alpha16 closeout absorbed the former Alpha17 boundary (owner direction
2026-11-21).
Form participation is **MIGRATED** (re-adjudicated 2026-11-20 / plan §19.3: the
framework mirrors the one constraint derivable from a declared property and hands
the author the complete `ElementInternals` seam for the rest, so constraint parity
is authored policy rather than framework debt). `useHost` is **DELIVERED**
(`useHost()` in `compile-lifecycle.ts`, exported from `lifecycle.ts` /
`public-surface.ts` / `public-runtime.ts`; ADR-0182 carries its implementation
amendment). Everything listed under "Still owed" is genuinely unfinished, not
deferred paperwork. The final-SHA
matrix and the verdict rows are re-recorded in the 2026-11-20 remediation (see
the `p1-applicability-record` re-record); this file asserts no new numbers.

## Slice index (§13.2 obligation → row)

§13.2 names five Alpha16b obligation slices. The rows above are organised by
capability, so this index maps each slice ID to the rows that satisfy it — a
reader holding the plan should not have to infer the correspondence.

| Slice | Capability | Rows in this document | State |
| --- | --- | --- | --- |
| `16b-LC` | Class lifecycle (CAP-03) | author lifecycle: connect / disconnect / property change | **MIGRATED (2026-11-21)** — root setup/hooks, nested hostless hooks at ANY depth (the cross-ledger transaction closed the depth ≥ 2 boundary), and the connection-scope `env` helper are delivered. What stays refused is PLACEMENT, not depth: a recipe/list body and a component no retained body references have no lifecycle owner (`OEIR_LEAF_INVALID_ARTIFACT` / `OEC9041`), which is the honest boundary of a compiled setup |
| `16b-EB` | Error boundary (CAP-05) | error boundary | **PARTIAL (by design, not deferred)** — the two capture points (connect/claim; update/refresh + event dispatch sharing one `guardUpdate` sink) AND the §19.2 SSR fallback (conditions 1–4) are delivered; the row is not flipped to MIGRATED only because a NEW identity for the fallback bytes is explicitly out of scope (§19.2 condition 2 says "under the unchanged claim and identity rules") |
| `16b-CTX` | Context (CAP-09) | context provider / consumer | **MIGRATED** (2026-11-19 anchor `e8ea72b95`, kept as history — off the delivery line; delivery-line row in the final-SHA matrix below) |
| `16b-REF` | Refs (CAP-11) | node refs | **MIGRATED** (2026-11-19 anchor `d135576d0`, kept as history — off the delivery line; delivery-line row in the final-SHA matrix below) |
| `16b-MN` | Migration note (CAP-26) | this document plus `16b-migration-note.md` | **TRACKED** — both are tracked and indexed; the owner sign-off is the remaining §13.5 item |

## Capability map

| Capability | Class authoring (retiring) | Generated lane (replacement) | State |
| --- | --- | --- | --- |
| Component declaration | `@element('tag')` + `class X extends OpenElement` | local default-exported function + `defineIslandConfig`/`defineComponentConfig` sidecar (`root`, `tag`, `properties`) | **MIGRATED** — the compiler emits the `OpenElementBase` subclass; island admission refuses a re-export default (`lane-declined / compiler-declined`) so the body must live in the admitted module |
| Reactive render | `render()` returning compiled JSX | function component returning compiled JSX; every sink is a compiled slot | **MIGRATED** (depends on emission: a value bound to a local identifier yields ZERO refreshes while the same expression inlined yields two — R1b, pinned by a regression test) |
| Derived values | `computed(() => …)` | **ADR-0183 D-4** — the `computed` intrinsic (compiler-erased; element-root resources are created by the retained setup factory and returned in its record; lazy; `Object.is` cut; scope-released; one evaluation per render on the server) | **MIGRATED** (`b38c1147b` first production consumer; D-4 landed 2026-11-20) — the retained `__oe_rootInstance` factory is the production binding source the earlier PARTIAL row was waiting for. A root `computed`/`signal` is created once per element, resolved by the unchanged `host.bindings` prologue in mount/claim, and re-created per render by the SSR producer (no server-side graph). 2026-11-20 lifecycle fix: a hook carried by the same factory reads those resources as closure captures instead of being silently dropped. Guard: `generated-element.computed-boundary.test.ts` plus the D-4 landed section in ADR-0183 |
| Property / attribute channel | `@property({ reflect, attribute })` | `properties` row in the sidecar: `{ reflect, attribute, default }` | **MIGRATED** — primitive rows convert through the same `convertFromAttribute`/`coercePropertyValue` leaves |
| Non-primitive property wire | runtime property assignment on the instance | `data-oe-prop-seed` host attribute carrying JSON (ADR-0182 D-18c), consumed once by `applyGeneratedPropSeed` | **MIGRATED** — `array`/`object` only; `trustedHtml` is excluded because the brand is object identity in a `WeakSet` and any wire transfer would re-forge trust from bytes |
| Author lifecycle: connect | `connectedCallback()` | `onConnect(env)` intrinsic, erased by the compiler into the claim/mount prologue | **MIGRATED** (runs BEFORE the generated region exists — a handler that scans the rendered subtree must defer one macrotask) |
| Author lifecycle: disconnect | `disconnectedCallback()` | `onDispose(env)` plus the connection-scope `abort` signal | **MIGRATED** (a disconnect keeps the generated DOM, LC-0, so a teardown that wrote state must restore the declared seed or the next claim fails) |
| Author lifecycle: property change | `attributeChangedCallback` / property setter | `onPropertyChange({ host, signal, states, name, value })` | **MIGRATED** |
| Error boundary | static `isErrorBoundary` + `catchError()` | `onError(env)` with the shell's capture points (connect/claim; update/refresh and event dispatch share the existing `guardUpdate` sink) plus the §19.2 SSR fallback (conditions 1–4 delivered) | **PARTIAL BY DESIGN** — all four §19.2 conditions hold; the row is not flipped only because a NEW identity for the fallback bytes is out of scope. No handler registered keeps the pre-existing rollback-then-rethrow byte-identically |
| Context provider / consumer | `provideContext(host, token, value)` + subscription | `provideContext(token, () => value)` / `useContext(token)` over the generated owner tree, hostless owners included | **MIGRATED** (`e8ea72b95`) — nested providers shadow, sibling subtrees are isolated, a declared-property commit re-reads the thunk, reconnect republishes from retained intents, and a consumer-reading component IS server-renderable (the scope rides the producer argument list, so per-render isolation is structural) |
| Node refs | `@query`/manual `querySelector` in `connectedCallback` | `ref(cb?)` declaration intrinsic handed to the existing `ref` JSX channel; `current` survives mount/claim/reconnect | **MIGRATED** (`d135576d0`) — no second attachment mechanism; `current` is deliberately not reactive (a tracked-slot read is refused with `OEC9042`) |
| Form participation | `static formAssociated` + `ElementInternals` access | sidecar `formAssociated` + the shell's form controller; value/required/disabled with `required → valueMissing`; the author-callable constraint seam (`setValidity`, `setFormValue`, `internals`, `onReset`, `onRestore`) | **MIGRATED** (`fa6e5232d`, re-adjudicated 2026-11-20 / plan §19.3) — the framework mirrors the one constraint derivable from a declared property and hands the author the complete `ElementInternals` seam for every other one, so type/email/pattern parity is authored policy, not framework debt (a shell-side mirror would be a SECOND validation model); non-claim: a `required`-only component gets `valueMissing` free, anything more it writes itself |
| Slots / light DOM | `static styles`, `<slot>` in the template | compiler-emitted slot anchors (`oe:s:<ordinal>:<hex>`) plus the light-root producer; `projectedChildren` substitution walks comment tokens only | **MIGRATED** |
| Styles | `static styles = css\`…\`` | file-based `.oe-style.css` imports plus the generated island's `defineIslandConfig({ styles })` declaration (the string-template tag retired with #1558) | **MIGRATED** — ONE declaration, one delivery per root/delivery shape: the DSD marked `<link>` inside a shadow template (M09-2e), the document sink for a light root, and (2026-11-20) the compiler's module-graph import the shell adopts for a client-only island. All of them ride the same style-edge registry, Vite CSS pipeline and content-addressed asset; the generated root joins the same `themeManager` broadcaster |
| Client-only shadow styles (`ssr: false`) | `static styles` + the client-created root (the class lane adopted the sheet in `connectedCallback`) | sidecar `styles` → compiler-emitted `.css` imports + descriptor `styles`; the shell adopts through the class lane's SAME `CompiledStyleScope` into the root it created, releases on disconnect and re-adopts on reconnect | **MIGRATED** (`b165ab443`-line, 2026-11-20) — the last open style capability. A declared sheet that reaches the emitter without a specifier fails the build (`OEIR_GENERATED_ELEMENT_CLIENT_STYLES_UNWIRED`); a non-sheet descriptor value fails closed with a coded build-phase error; a link-delivered DSD root is never adopted twice |
| Nested light root inside a shadow template | not applicable — contradictory composition | **NOT A CAPABILITY — written rule (2026-11-20)**: a light root must not be rendered inside another component's shadow template (document stylesheets never cross the boundary; the class lane's hoisted link was a workaround). Use a `<slot>` or make the child a shadow root. 0 product instances; `site-light-probe`'s port measured the gap and was reverted; its e2e row is rewritten to the rule as part of the lane deletion. ADR-0181's 2026-11-20 rule section. |
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
| `16b-LC` recipe/list placement and pre-DOM timing | **Depth ≥ 2 is DELIVERED (2026-11-21)** — a retained body that retains its own children joins the root attempt's transaction and keeps its record across reconnect (ADR-0181's dated amendment; Chromium rows R8/R10/R11). What is still refused is PLACEMENT: a hook or context intrinsic inside a reusable-JSX/list body, or in a component no retained body references, has no lifecycle owner (`OEIR_LEAF_INVALID_ARTIFACT` / `OEC9041`). Pre-DOM timing stays a documented semantic (a connect handler runs before the generated region exists). |
| `16b-EB` SSR fallback — conditions 2–4 | **Condition 1 IS delivered** (2026-11-20): a failing descendant producer now renders the enclosing boundary's fallback bytes, the failure is carried out to `onNestedFailure` instead of failing the whole render, and with no boundary the original error still propagates. **Condition 2 is also delivered** (2026-11-20): the render path emits those fallback bytes in consumer form and the failure reaches the report channel, with a no-report-channel row proving it propagates. **Condition 3 is also delivered**: the fallback bytes are byte-identical to no-expansion bytes, so claim parity is structural, and the two Alpha16 capture points are unchanged. All four §19.2 conditions now hold; the row stays UNFLIPPED only because a NEW identity for the fallback bytes is explicitly out of this delivery, not because anything is deferred to another milestone. |
| ~~`useHost` host-element accessor (D-17b)~~ | **CLOSED 2026-11-20 — this row was STALE.** `useHost()` is implemented (the compiler-erased intrinsic in `compile-lifecycle.ts`, exported from `lifecycle.ts` / `public-surface.ts` / `public-runtime.ts`, with the 6-row `generated-element.use-host.test.ts` guard) and ADR-0182 carries its implementation amendment. The row still said FUTURE/OWED, which is exactly the two-faces-one-fact drift the design constitution forbids; it was corrected here rather than left for a reader to reconcile. |
| ~~Depth ≥ 2 generated owner tree~~ | **CLOSED 2026-11-21.** ADR-0181's cross-ledger transaction is implemented: the root pass owns an `InstanceTransaction` token, a retained body that retains its own children JOINS it, the root commits members shallow-first / aborts them deepest-first, and evicting an entry releases that scope's own ledger. Depth-1 modules keep their pre-change bytes. |
| ~~Form constraint mirroring~~ | **CLOSED 2026-11-20 — re-adjudicated, not deferred** (plan §19.3). The framework mirrors `required → valueMissing` and exposes the complete `ElementInternals` seam (`setValidity` / `setFormValue` / `internals` / `onReset` / `onRestore`) on the form control, so type/email/pattern parity is authored POLICY. A shell-side mirror would be a SECOND validation model that drifts from the platform's constraint algorithms — refused for the same reason a second stylesheet pipeline was. Named non-claim: a `required`-only component gets `valueMissing` free; anything more it writes itself. |
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
- **provenance:** `LOCAL` — a clean worktree at the cited commit; a
  LOCAL record only, not a CI run/job; it writes no CI column.
- **environment:** macOS (darwin), 8 cores / 16 GB; Node `v24.18.0`; pnpm
  `12.8.1`; Playwright `1.59.1` (chromium `147.0.7727.15`, firefox `148.0.2`,
  webkit `26.4`).
- **full log:** `.artifacts/pr1804-remediation-20261120/02-evidence/EVIDENCE-RUN.md`.

| §13.2 slice | state | command → result at the measured commit |
| --- | --- | --- |
| `16b-LC` | **MIGRATED (2026-11-21)** — root author lifecycle, nested hostless hooks at any depth and the connection-scope `env` helper; recipe/list placement and non-retained targets stay refused by design | `./node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/compiler test` → **102 files / 1421 tests passed**; `--filter @openelement/element test` → **136 files / 1063 tests passed**; the focused depth ≥ 2 acceptance is `generated-element.root-instance.browser.test.ts` (11 Chromium rows, incl. R8 retained grandchild, R10 aborted attempt convergence, R11 subtree teardown) and the ledger's 40 unit rows. Provenance `LOCAL .agents/worktrees/alpha16-retirement` |
| `16b-EB` | **PARTIAL BY DESIGN** — the two capture points (connect/claim; update/refresh + event dispatch through one `guardUpdate` sink) and the §19.2 SSR fallback conditions 1–4 (boundary fallback bytes, failure carried out, no whole-render failure, claim parity over identical bytes). The row stays PARTIAL only because a new identity for the fallback bytes is out of scope
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
