---
status: active
topic: Milestone status and evidence ledger
summary: One row per milestone with the evidence PR, squash SHA, commands and result; also the Alpha16a exit gap list and the audit closure register.
---

# Alpha16–18 progress ledger and audit closure register

Date: 2026-11-09. Baseline: `origin/main` =
`bbe25445dda16afae0ba99e477eec55a96245844` (PR #1748, the last slice of the 2026-11-09 landing batch: PRs
#1746/#1745/#1747/#1749/#1748); the 2026-11-03 audit closure register in §5 is
re-verified against the same tree. The current batch baseline is
`origin/main` = `b82e63bdfa1794897e9ddf1ef32c262f48368883` (PR #1757, 2026-11-12); the M07 closeout decision and the
M07-5 sign-off in §4.3/§4.4 are recorded against that tree.

This is the tracked status record for the Alpha16–18 milestones and for the
2026-11-03 audit ledger (C2). It records evidence; it does not define gates. The
PR that changes a status updates its row in the same change, and a `complete`
row must name the exit evidence the execution plan asks for.

## 1. Authority

The single stage authority is the tracked
[Alpha16–18 execution plan](./alpha16-18-execution-plan.md) (2026-11-03, fourth
pass; owner decision D-O1 and the P-1…P-5 package approved 2026-11-03). Its
work classes (§0), milestone table (§1), dependency spine (§3), exit sets
(§1/§8a/§8b/§11) and slice definitions (§4) are the only stage and gate units
used here.

The execution plan's "Nothing here is implemented" line is a plan-level
statement about the implementation; it is not a denial of the merged design,
spike and prototype slices recorded below — those are Class A/P records, and
none of them completes an implementation milestone.

What is not the stage authority:

- **Local taskbook material** — `.agent/Alpha16_TaskBook_v7.1.md`, the v7.1
  FreezeRecord and the local Stage prompt. The material is marked HISTORICAL
  (read-only) as of 2026-11-06, sits outside the committed tree, and is not an
  execution entry. The tracked statement of the session execution model is
  [docs/agent-contract.md](../agent-contract.md#session-execution-model-owner-ruling-2026-09-21).
- **GitHub issue #1646** ("Current scope v1.2 + historical v7.1 / alpha15
  closeout", OPEN) — a scope index for planning, not the stage authority.
- **The v7.1 gate names G1a/G1b** — not repository M-gate units. The work they
  track stays open: C-0 #1652 (compile-semantics ADR) and C-3 #1655 (base
  codegen) are OPEN.
- **The issue tracker** — milestone `1.0.0-alpha.16` (#37) carries **40 open
  issues, 0 closed and 0 open pull requests**, measured 2026-11-08 through the
  GitHub search API; the milestone counter shows 43 and is stale (last updated
  2026-10-31). The issues still use the pre-fourth-pass numbering: remapping
  them to M01–M14 is a C1 follow-up; until it lands, the tracker is not evidence
  for a status in this ledger.

## 2. Status vocabulary and evidence rules

Status values used below:

- **complete** — the execution-plan exit evidence exists at a recorded SHA.
- **in progress** — a design, spike or prototype slice is merged; the
  milestone's exit evidence does not exist.
- **not started** — no slice merged for the milestone.

Evidence rules, applied to every row:

1. **SHA + command + result.** A row's evidence is a merged PR number and
   squash SHA plus the commands and their result summary; the full record lives
   in the referenced document or the merged PR body. A claim without a SHA is a
   plan, not a status.
2. **Prototypes never count as completion.** A Class P row stays `in progress`
   even when the prototype is merged and its checks are green (execution plan
   §0). "Prototype merged" is not "M-row complete", and no prototype table can
   fill a G1/G2 cell.
3. **CI green is not browser qualification.** Three-engine browser + server
   qualification is M13 (execution plan §1/§11). A green chromium-only PR job is
   not M13 and closes no milestone. Browser evidence names the engine (and its
   revision where it is a pinned build); local claims are recorded as local
   claims.
4. **Evidence is per head.** Test counts from one head are not evidence for a
   later head. When a slice changes code above a recorded SHA, its counts are
   re-recorded at the new head — the M05 prototype does this explicitly (the
   audited baseline and the merged PR head differ).
5. **Prototype artifacts are named as such.** A prototype's report states
   "PROTOTYPE", its scope and its not-claimed list; a gate record may cite it
   only as mechanism evidence, never as the gate result.

### 2.1 G1/G2 evidence record template

A G1 or G2 gate record is opened only when the execution-plan exit evidence
exists at a recorded SHA (execution plan §1, §8a). The five evidence rules of §2
(1–5) apply to every field and are not restated here. The Lead compiles the
record and the owner signs it off before the §4 row flips (owner decision D2,
2026-11-08).

| Field | What the record carries |
| --- | --- |
| Gate | G1 (generated code executes) or G2 (ownership/recipe evidence) |
| Evidence PR + squash SHA | the merged PR number and the squash SHA the evidence was produced at (per-head rule 4) |
| Exact commands | the commands that produced the evidence, verbatim |
| Result summary | pass/fail counts per command and the matrix cells the result fills |
| Engine + revision | every browser engine and its revision when browser evidence is claimed, each claim labelled LOCAL or CI (rule 3) |
| What was NOT verified | the boundaries of the claim, in the [M05 prototype record §7](./m05-g1-leaf-prototype.md#7-not-claimed) style |
| Classification | prototype or production (Class P vs Class I, execution plan §0); a prototype is cited as mechanism evidence, never as the gate result (rule 2) |
| Recorder / sign-off | Lead compiles and records, owner signs off (D2) |
| Where recorded | the PR body plus the matching row in §4 of this ledger, carrying the same SHA |

## 3. Milestone ledger (M01–M14)

| Milestone | Class | Status | Evidence PR / SHA | Notes |
| --- | --- | --- | --- | --- |
| M01 | A | Complete (decision record) | #1704 `554a54a33` (2026-11-03) | The layer map, IR and ABI boundary are recorded in [the M01 boundary doc](./compiler-ir-and-abi-boundary.md). Its "DESIGN — not implemented" line is the Class A contract: the M01 deliverable is the recorded decision, not code. |
| M02 | I | Complete (feasibility exit evidence recorded) | #1729 `447eaa347` (2026-11-08) | The [M02 report](./m02-semantic-ir-feasibility.md) proves the IR can express the five worked examples; the 2026-11-08 exit closeout adds the last §1a criterion-4 piece — the admitted `condition` node's branch-shape negative case in `packages/compiler/__tests__/semantic-ir/invariants.test.ts` ("a conditional branch that is neither JSX nor null") asserts `OEIR_CONDITION_BRANCH_UNSUPPORTED` with `origin: 'source'` and an in-source span. Evidence at `447eaa347`: `npx vitest run --project compiler` → 22 files / 332 tests passed, a LOCAL run; `pnpm check` and the doc gates are green at the PR head (commands and counts in the PR body). §1a criteria 1/2/3/5/6 were already met; §9 OPEN-1/2/6 stay M03 work, OPEN-5 stays M04 work, and OPEN-4 (claim marker) stays OPEN in M02 by §1a criterion 3. NOT verified: no M03+, codegen, runtime, browser, ABI or G1/G2 evidence — this is the feasibility exit record only. |
| M03 | I | Complete (frontend parity evidence recorded) | #1706 `463e6cb07` (design), #1707 `e23420d3a` (M03-I-0), #1730 `39cac9548`/`a1cd53b7d` (M03-I-1 A1 resolver), #1731 `d59bc770f` (M03-I-2 A2 lowering/registry), #1732 `1423ad18c` (M03-I-3 A3 erasure/oracle), #1733 `fa752e79c` (M03-I-4a A4 frontend/diagnostics parity), #1734 `da57256d0` (M03-I-4b A4b source-map/security parity + matrix; squash SHA) | The [M03 implementation log](./m03-implementation-log.md) records the slice-by-slice implementation and evidence. Exit evidence: Alpha15 **diagnostics parity** (A4a harness — shared security constructs agree class-vs-function on OEC code + offending authored token; C+ parity; T+/T− from the TypeScript authority; asserted/NOT-asserted list explicit), **expression-level Source Map parity** (A4b — decoded through `@jridgewell/trace-mapping@0.3.31`; plain/shrink/JSX-substitution/multi-line corpora; anchors-not-ranges; Alpha15 map convention comparison), **security parity** (A4b — canonical predicates reused with no second sink table; per-admitted-position negatives vs the Alpha15 baseline; dynamic `innerHTML` conservatively refused pending a trusted-HTML contract), and the semantic-test-matrix M03-scope T+/T−/C+/C− rows at the evidence head. Evidence at `da57256d0` (LOCAL): `npx vitest run --project compiler` → 32 files / 590 tests passed; `pnpm check` PASS; frozen-lockfile probe PASS; PR-head CI recorded in the PR body. NOT verified/claimed: no G1/G2, no browser or M13 qualification, no codegen/runtime, no end-to-end generated-module map (M05), no Alpha16a exit (M04–M08 + G1/G2), no class retirement, no public API/ABI/Part Program; `OEC9040`–`OEC9044` remain provisional/internal. |
| M04 | P→I | Complete (G2 record signed off 2026-11-09; see §4.1) | #1735 `a82ef5957` (M04a/M04b primitives + G2 probes; squash SHA) | Compiler-neutral runtime primitives under `packages/element/src/internal/compiled/runtime/`: per-projection insertion owner + region (`recipe.ts`), tracked props with per-read getters and a replaceable backing value (`props.ts`), projection lineage check (`lineage.ts`), both `LifetimeScope` disposal modes with exception-safe rollback, and the browser-safe shared value/binding extraction (`values.ts`/`bindings.ts`; `program-kernel`/`server/shared` delegate). G2 probes (a–e) in `packages/element/__tests__/compiled-runtime/{recipe-insertion,runtime-disposal,runtime-props,runtime-lineage}.test.ts`; LOCAL evidence at `a96a4327c`: `npx vitest run --project element` → 110 files / 756 tests passed; `pnpm check` PASS; seams 49/49; adr-index 34/34; doc-claims PASS. The G2 record, compiled by the Lead from the PR #1735 draft, is recorded in §4.1 and was signed off by the owner on 2026-11-09 (D2). NOT claimed: G1 (separate M05 record), browser/M13, codegen/M05, claim/hydration, Alpha16a exit. |
| M05 | I | Complete (G1 record signed off 2026-11-09; see §4.1) | #1735 `a82ef5957` (M04 primitives dependency), #1736 `70913e064` (M05a generated leaf mount/update/dispose v2 + S1 browser evidence; squash SHA), #1737 `896ee8fab` (M05b end-to-end generated-module source map; squash SHA) | The **M05a** slice supersedes the Class P leaf-codegen prototype (dated supersession note in [the prototype record](./m05-g1-leaf-prototype.md)): a compiler-private generator (`semantic-ir/generated-leaf/generate.ts`) consumes the M03 `FunctionModelModule` + registry and emits concrete mount/update/dispose JS that calls the merged M04 primitives (`createRecipe`/`insertRecipe`, `bindSignalWrites`, `displayValue`/`attributeValueOf`/`assertSafeUrlAttribute`) — no Part Program/`__partProgram`/ABI, no generic interpreter, no production wiring. S1 real-engine evidence at `0ffc89263` (LOCAL, chromium 147.0.7727.15): 5/5 browser tests — single root mount + signal/computed + props refresh + default dispose keeps DOM; detach dispose removes the region; multi-root/fragment order; empty output mounts no nodes; a throwing cleanup does not block remaining cleanups or region removal. Evidence: `npx vitest run --project compiler` → 35 files / 626 tests passed at M05b (616 pre-existing + 10 map tests); `pnpm check` PASS; doc/registry gates green; PR-head CI recorded in the PR bodies. M05b adds the end-to-end generated-module Source Map: the generator now records a placement ledger for every lowered expression (ExprId + generated/authored coordinates), composes the A2 `EmissionSegment`s into module coordinates (multi-line lowering included), and assembles a deterministic Source Map v3 with `sourcesContent` via the shared `SourceMapSegmentBuilder`; 10 consumer tests decode it through the pinned `@jridgewell/trace-mapping@0.3.31` (placement→authored start, composed segments, multi-line, erasure-shrunk text never maps the removed range, structural DOM anchors, no bogus mappings on scaffolding, determinism). JSX→recipe-ref replaced positions are a named boundary: nested recipes remain refused (M06/M07), and the anchors-not-ranges property stays asserted at expression level by A4b. The G1 record, compiled per the §2.1 template from the PR #1736 draft, is recorded in §4.1 and was signed off by the owner on 2026-11-09 (D2). NOT claimed: firefox/webkit/M13, claim/SSR, M06+, conditions/lists/component refs/recipes in generated code (M06), packed consumer, production wiring, class/ABI/public API. |
| M06 | I | Complete (S2 generated stateful list + composition evidence recorded) | #1738 `9903570f1` (M06a conditions + lists/keyed reorder + S2 browser evidence; squash SHA), #1739 `05a89202b` (M06b1a-1 module-level component mounts + component references; squash SHA), #1740 `70e43622f` (M06b1a-2 reusable JSX recipes + insertion sites; squash SHA), #1741 `3acca6e40` (M06b1b chromium owner-isolation evidence + matrix TSX-09/23; squash SHA), #1742 `303637adf` (M06b2a component children projection; squash SHA), #1743 `0ee78ec78` (M06b2c list-entry item refresh fix; squash SHA), #1744 squash `c70dc8d0a` (M06b2b children-projection + unkeyed browser evidence + matrix TSX-08/10/26; pre-merge evidence head `241c1eef7`) | **M06a** widens the compiler-private generated-leaf v2 generator for the stateful hostless list: conditions (comment anchor + generated branch builders, per-branch `LifetimeScope`, `removeNodes` range cleanup, `dispose(true)` replacement, rollback/rethrow on a throwing branch) and lists (per-entry owners/regions, generated key thunk, keyed reuse with in-place `update`, insert/delete/unkeyed/multi/empty root, subscription to the items/key outer reads, disposal of removed entries, minimal-move keyed placement) — all through the merged M04 primitives; `key` is consumed as list identity, never a DOM write. S2 real-browser evidence at `74f7badc0` (LOCAL, chromium 147.0.7727.15, real M04 runtime bundle): keyed reorder preserves DOM node identity, private-draft write keeps entry identity, delete/insert closes removed-entry subscriptions (`runtimeProbe` delta), condition toggle replaces branches without leaking, focus + selection survive keyed reorder, throwing branch surfaces the error and recovers. The module source map covers the new emitted shapes (placements decode through the pinned `@jridgewell/trace-mapping@0.3.31`). Evidence: `npx vitest run --project compiler` → 35 files / 632 tests passed (626 pre-existing + 6 new/updated); `pnpm check` PASS; doc/registry gates green; PR-head CI recorded in the PR body. **M06b1a-1** (#1739, evidence head `d0acc21c4`, LOCAL) emits one module-level `function <Name>__mount(scope, props, host)` per component (the exported `create<Name>Recipe(owner, host)` factory keeps its name/signature and delegates) and admits module-local component references (`<Child prop={expr}/>`) with a per-read prop getter record over the defining parent scope, a `host.propDeps` refresh channel (root factory: `[host.propsChanged]`; reference site: the parent bindings behind the passed prop expressions), a fresh child scope with `dispose(true)` rollback + range cleanup, and authored order; component chunks are line-rebased for the module source map. New fail-closed codes: `OEIR_LEAF_UNKNOWN_COMPONENT` (external/unknown), `OEIR_LEAF_COMPONENT_CYCLE` (reference-graph DFS with the cycle path, checked before emission), `OEIR_LEAF_UNSUPPORTED_COMPONENT` (child with no named props parameter, child owning signal/computed resources, `children` prop, component reference inside a list entry template pending the M06b1b child update hook); `class`/`style`/`innerHTML`/`event`/`ref` prop channels reuse `OEIR_LEAF_UNSUPPORTED_ATTRIBUTE`. Evidence at that head: `npx vitest run --project compiler` → 35 files / 650 tests passed (LOCAL; the pre-existing 9 chromium S1/S2 browser tests re-ran as regression, no new browser claim); `pnpm check` 5/5; pre-push gate set passed; PR-head CI in the PR body. **M06b1a-2** (#1740, evidence head `6716cfb2b`, LOCAL) admits reusable JSX values: `FunctionModelResource.recipeId` links a direct component-local JSX initializer to its recipe (plain model metadata; the generator never re-derives the link), `{name}` slots become `insertion-site` nodes (an enclosing list-mapper parameter shadows the component local), the generator emits one inline `createRecipe` per referenced value with its own recipe scope and one temp-`DocumentFragment` + `insertRecipe` projection per site whose `projection.nodes` are spread into the enclosing sink in authored order, and the M06b1a-1 cycle DFS is generalised to a mount graph over components and recipes (`OEIR_LEAF_RECIPE_CYCLE`). Unsupported shapes stay refused with `OEIR_LEAF_UNSUPPORTED_RECIPE` (JSX lowered inside a non-initializer expression, a reusable value read as an expression value, an insertion site not targeting a direct initializer) plus the defensive `OEIR_LEAF_MISSING_RECIPE`. Evidence at that head: `npx vitest run --project compiler` → 35 files / 664 tests passed (LOCAL, 650 baseline + 14 new; no browser claim); `pnpm check` 5/5; pre-push gate set passed; PR-head CI in the PR body. **M06b1b** (#1741, evidence head `55aec15b9`, LOCAL, chromium 147.0.7727.15) adds the real-browser owner-isolation evidence: the S2b suite proves component-reference mounts with per-read prop refresh and distinct instances, one reusable-JSX recipe projected at two sites (three independent projections; one write refreshes both copies), the same recipe inserted twice (insertion delta 2 for `projections`/`regions`/`owners`/`nodes`/`rangeCleanups`/`subscriptions`, two admitted lineage checks, zero rejections), disposal isolation (`dispose(true)` removes only its region while the other projection keeps refreshing; default `dispose()` keeps DOM), and the coded owner-lineage negatives (`OE_KERNEL_ROOT_NOT_OWNED` / `OE_KERNEL_DISPOSED`, `lineageRejected` moves with zero allocation and the definition owner + a live descendant stay admitted). The semantic-test-matrix gains the `M06b S2b recorded results` section with TSX-09 and TSX-23 pass, TSX-10/TSX-26 not run. Evidence at that head: `npx vitest run --project compiler` → 35 files / 669 tests passed (LOCAL, 664 baseline + 5 browser); the focused browser file 14/14; `pnpm check` 5/5; pre-push gate set passed; PR-head CI in the PR body. **M06b2a** (#1742, evidence head `26e7d75a0`, LOCAL) admits component children projection per the JSX value model §4.4: `FunctionModelComponentRef.childrenRecipeId` links `<Frame>…</Frame>` to a per-ref-site children fragment recipe (`FunctionModelRecipe.target` admits a fragment), the generator emits one `createRecipe` per ref site (definition owner = the emitting mount/recipe scope) and passes it as a plain `children` prop, a children-projecting component reads it once at mount with a shape check (`OEIR_LEAF_MISSING_CHILDREN` for a host/root instance without a real recipe), and every `{props.children}` site is a `DocumentFragment` + `insertRecipe` projection on its live builder scope (two sites = two owners/instances). `props.children` in an expression value is refused by the frontend (`OEC9042`); children on a reference inside a reusable-JSX recipe body (`OEIR_LEAF_UNSUPPORTED_CHILDREN`), nested children of that shape, explicit `children=` props and children-recipe cycles (`OEIR_LEAF_RECIPE_CYCLE`) stay refused; the emitted-module marker now names `M06b2a`. Evidence at that head: `npx vitest run --project compiler` → 35 files / 685 tests passed (LOCAL, 669 baseline + 16 new; no browser claim); `pnpm check` 5/5; pre-push gate set passed; PR-head CI in the PR body. **M06b2c** (#1743, evidence head `411680b65`, LOCAL) fixes a defect found by the M06b2b real-browser evidence: unkeyed positional reuse and same-key keyed replacement kept the first render's item snapshot because a dynamic-text/dynamic-attribute slot reading the mapper parameter has zero reactive dependencies and therefore registered no refresh closure. The zero-dependency paths now emit a registered refresh on the enclosing entry collector (`update(next)` re-runs it) when the record reads an entry-local name; component-mount output and non-entry-local static writes stay byte-identical; entry-name bookkeeping is save/restore so a nested list shadowing the mapper name cannot hide the outer read; no runtime/M04 change and no new mechanism. Covered: unkeyed `{item}` content, keyed same-key replacement, entry-local dynamic attributes, condition-in-entry with JSX branches (existing condition refresh forced), nested list inside an entry (outer update calls the inner list refresh), reusable-JSX insertion sites in entries; component references inside entries stay refused (`OEIR_LEAF_UNSUPPORTED_COMPONENT`). Evidence at that head: `npx vitest run --project compiler` → 35 files / 693 tests passed (LOCAL, 685 baseline + 8 new); `pnpm check` 5/5; pre-push gate set passed; PR-head CI in the PR body. **M06b2b** (#1744, evidence head `241c1eef7`, LOCAL, chromium 147.0.7727.15) completes the S2 evidence: children projection in a real engine (two `{props.children}` sites = two independent instances/subtrees, one parent write refreshes both, root detach dispose closes both subscriptions), generated-site deletion isolation (site A `dispose(true)` removes only A's region while B stays attached and keeps refreshing; default dispose keeps DOM), the host/root children boundary (`OEIR_LEAF_MISSING_CHILDREN`, no DOM written), the unkeyed list update sequence (`['a','b','c'] → ['a','b','c','d'] → ['b','d']` renders exactly those texts after the M06b2c entry-local refresh; positional identity only — DOM node identity not claimed), and same-key keyed content replacement (both `<li>` nodes preserved, text updated) recorded as TSX-04-adjacent supporting evidence; the semantic-test-matrix gains the `M06b2b recorded results` section with TSX-10, TSX-26 and TSX-08 pass. **M06 exit evidence is complete**: conditions/lists (keyed and unkeyed update), private-draft entry identity, multi/empty root, component references with per-read props, reusable-JSX recipes and insertion-site projections, children projection, owner/disposal isolation — browser-evidenced on chromium 147.0.7727.15 (LOCAL). NOT claimed by this row: browser/server three-engine qualification (M13), the TSX-04 matrix row, nested children composition and component references inside list entries (still refused), M07/M08 claim/SSR, production wiring, packed consumer. |
| M07 | I | Complete (per the 2026-11-12 exit amendment, §4.3; Alpha16a exit not met) | PR #1745 (squash `0a97602c4`), PR #1747 (squash `0df1621a5`), PR #1749 (squash `2dcb57871`) | **M07a** adds an optional compiler-private `claim` on a generated leaf recipe whose shape is only elements, fragments, static text, static attributes, and dynamic text/`attribute`/`boolean` slots. `<Name>__claim` adopts the parent's existing children in authored order; a structural mismatch throws `OEIR_LEAF_CLAIM_MISMATCH` before any subscription; `claimRecipe` then registers one range cleanup. Validation that throws before a write leaves zero DOM writes. An activation throw after a dynamic write releases resources with `dispose(false)` and may leave that write in place; borrowed nodes are not deleted, and this is not a whole-claim byte rollback. A recipe without `claim` raises `OE_RUNTIME_LEAF_CLAIM_UNAVAILABLE` before an owner is allocated. Successful-claim input, focus and selection preservation stayed an unmet obligation through M07a. Conditions, lists and `property` channels stay mount-only. Component references, reusable JSX and children projection stayed mount-only through M07a. **M07b** adds a private static sibling-range directory (paired comments `oe:r:<ordinal>`/`oe:/r:<ordinal>`, caller-supplied expected ordinal or a held start handle, in-order consumption, parent-scoped reservation and success tombstone, static DOM seed) and is one component of the §4.3 exit set, not an exit by itself. NOT this row's exit: key alignment, dynamic seed, subscription multisets, bounded mismatch recovery, input/focus preservation, SSR (M08), TSX-18/TSX-30, mount-emitted markers, production wiring, a public ABI, packed-consumer or browser qualification. The marker/seed private contract stays OPEN (not a public ABI freeze). M07-5 (signed off on `b82e63bdfa1794897e9ddf1ef32c262f48368883`; §4.4) records the generated-leaf alignment in [the M07-5 protocol record](./m07-5-protocol-record.md): D-2 suppresses unconsumed mount markers; static attribute seed is an ordered exact set (HTML case-folded names); structural mismatch is an `OpenElementError` whose code stays the internal identity `OEIR_LEAF_CLAIM_MISMATCH` (not a member of the exported `RuntimeErrorCode` catalogue, and no public snapshot change) and is not the directory code; the claim path requires the HTML namespace. The directory code `OE_RUNTIME_STATIC_RANGE_MISMATCH` and its case labels are unchanged. Both earlier additive public runtime codes remain candidate API for Alpha16a (owner decision 2026-11-09, recorded in the ABI boundary amendment). **M07b generator extension** (PR #1749) emits the paired `oe:r:` markers for a parent whose flattened children are two or more fully static elements and claims them through the directory consumer; §13.2 of the retired M07 workboard (Git history, 2026-11-10) records D5 as closed by this bounded, Owner-accepted extension. **M07-1** (signed off on `ac8c218614e2d4749435c51edf3eaf15eb65f6fd`; not an M07 exit) is composition / repeated-insertion order alignment at leaf scope. A claimable component reference, a reusable JSX insertion and a `{props.children}` projection are adopted from the same authored sibling cursor the mount wrote; each insertion or children site is its own `claimRecipe` projection with an independent owner and region. The claim-time recipe is a projection descriptor whose `mount` throws `OEIR_LEAF_CLAIM_MISMATCH`; it is not a second mount path. A component whose roots are a static sibling directory is not claimed from inside another sibling list. Evidence artifact: `packages/compiler/__tests__/semantic-ir/generated-leaf.order.test.ts`. The claim input is the generated mount tree after `dispose(false)`, which is not SSR→claim. Node DOM shim, 非浏览器资格. M07-1 is signed off on main `ac8c218614e2d4749435c51edf3eaf15eb65f6fd`. NOT claimed by M07-1: SSR, TSX-18, TSX-30, M07-2 browser fidelity, M07-4 mismatch recovery, M07-5 marker suppression, M08, list key alignment, treating `activate = () => {}` as a dynamic claim, and treating a failed `claimRecipe` whose owner/region counters move by one as a pass. The synchronous leaf four-phase path stays 「服务端 HTML 字符串 → 生成叶 claim」 and is not widened to stateful composition. **M07-2** (signed off on `70eb2381cab2ef238903cb583f3925976206e901`; not an M07 exit) is the browser clean-path claim. Claim-period first writes in `generate.ts` (the zero-dependency write and the `refresh()` that runs immediately before subscribe) skip the DOM API when the current value already equals the value that would be written; mount writes stay unconditional. Skipping the write does not skip the subscription. A later signal delivery shares that refresh body only as an implementation coupling and is not an accepted update-period zero-mutation result, not mismatch recovery, and not reseeding. Evidence artifact: `packages/compiler/__tests__/semantic-ir/generated-leaf.claim.browser.test.ts`. Browser qualification (chromium 147.0.7727.15, LOCAL): the four M07-1 frozen shapes, per-site subscription accounting, and a static input's focus and selection. During a successful claim a MutationObserver on the observation root records 0 product mutations. The four shapes' claim input is still the generated mount tree after `dispose(false)`. The synchronous leaf path is 「服务端 HTML 字符串 → 生成叶 claim」 (`seedHtml=<p id="leaf">seed</p>`, generated module has no `__h(`). This is not SSR→claim. NOT claimed by M07-2: TSX-18, TSX-30, M07-4, M07-5, M08, firefox/webkit/M13, an update-period zero-mutation acceptance, and an M07 exit. Known consequence recorded against M07-5 (signed off on `b82e63bdfa1794897e9ddf1ef32c262f48368883`; not an Alpha16a exit): a pure-mount tree no longer emits unconsumed `oe:r:` / `oe:/r:` markers (ADR-0175 D-2). A component that emits a claim function still mounts them. **M07-4** (signed off on `c4bff6dfc7efbdf2d5ad65442b82f1ccd4b3bb20`; not an M07 exit) is bounded mismatch recovery for a directory claim (ADR-0175 D-1). A failed claim releases the reservation, rolls back tombstones and the success cursor committed in that attempt, and releases those owners with `dispose(false)`. Borrowed nodes are not deleted. A dynamic write that already happened may stay. A directory claim that commits every declared range stays permanent, including after `dispose`. This is not byte-level DOM restoration, not SSR→claim, and not an M07 exit. Evidence is the element runtime suite, 非浏览器资格 (Node DOM shim), and is not the M07-2 chromium clean-path. Fixed-head QA records: #1747 `4feffef00` (pass) and #1749 `d7a4db434` (pass). The M07 exit amendment (owner-approved 2026-11-09, §4.2) moves the SSR producer/permitted seed and key alignment to M08. |
| M08 | I | Not started | — | Claim + SSR for the stateful list; depends on M06/M07. Absorbs the generated-leaf SSR producer, the permitted seed-state compare and list key alignment (§4.2, 2026-11-09) and the TSX-18/TSX-30 leaf-scope cells (§4.3, 2026-11-12). |
| M09 | I | Not started | — | Alpha16b: generated Native Custom Element boundary. |
| M10 | I→Q | Not started | — | Alpha16b: legacy-consumer migration and retirement evidence; five separate proofs per §12a. |
| M10a | Q | Not started | — | Alpha16b early, non-gating smoke. The prototype's consumer test is M10a-shaped only and is explicitly not M10a/M12 qualification. |
| M11 | I | Not started | — | Alpha16b: Router integration for the generated path. |
| M12 | Q | Not started | — | Alpha16b: final packed-consumer qualification of the stateful list. |
| M13 | Q | Not started | — | Alpha16b: three-engine browser + server qualification at an exact SHA. The three engines belong here, not to G1. |
| M14 | I | In progress (bounded server-function full-await slice on the Alpha15 lane; M14 exit not met) | PR #1748 (squash `bbe25445dda16afae0ba99e477eec55a96245844`) | Alpha16b: async server components, full-await. **Bounded slice**: async server function components are admitted only as a single JSX return with `await` in text children and in nested server-component props; generated normal/error/404/SSG entries await the new published `renderFunctionPageAwaited` seam; the synchronous `renderFunctionPage` string contract is unchanged; attribute/condition/list-item/arbitrary-expression await and a sync parent of an async child stay refused with `OEC9032`; the production admission bridge refuses the near-miss shapes (statements before the return, block-bodied arrow). LOCAL evidence: compiler focused 203 tests, router 121 tests, element focused 64 (Node v24.18.0); PR-head CI green. NOT claimed: full M14, M13 three-engine qualification, the M08 generated-leaf SSR producer, streaming/defer (Alpha18), any release claim. |

## 4. Gate records (G1/G2) and the Alpha16a exit check

**Alpha16a exit = M01–M08 with G1 and G2 evidence recorded** (execution plan
§1). G3 is not claimed by Alpha16a; M09–M14 are Alpha16b work and do not gate
16a; M10a is a non-gating early smoke.

| Exit requirement | Status | Gap |
| --- | --- | --- |
| M01 | Met | Decision record merged (#1704). No implementation is owed by M01. |
| M02 | Met | Feasibility exit evidence recorded at #1729 `447eaa347`: execution-plan §1a criteria 1–6 are met, including the admitted `condition` node's branch-shape negative case (see §3). No M03+, codegen, runtime/browser evidence or G1/G2 record is claimed. |
| M03 | Met | Function-component frontend parity exit evidence recorded in the [M03 implementation log](./m03-implementation-log.md): A4a diagnostics parity + A4b expression-level Source Map and security parity + semantic-test-matrix M03-scope rows. Evidence at `da57256d0` (LOCAL): `npx vitest run --project compiler` → 32 files / 590 tests passed; `pnpm check` PASS; `pnpm install --frozen-lockfile --lockfile-only --ignore-scripts` PASS; CI at the PR head. NOT claimed: G1/G2, browser/M13, codegen/runtime, end-to-end module Source Map (M05), Alpha16a exit, class retirement. |
| M04 | Met | G2 record compiled from PR #1735 and signed off by the owner 2026-11-09 (§4.1). Evidence at #1735 `a82ef5957` (LOCAL): `npx vitest run --project element` → 110 files / 756 tests passed; `pnpm check` 5/5; interface snapshot unchanged; PR-head CI green. NOT claimed: G1, browser/M13, codegen/M05, claim/hydration, Alpha16a exit. |
| M05 | Met | G1 record compiled from PR #1736 and signed off by the owner 2026-11-09 (§4.1). M05a `70913e064` + M05b `896ee8fab`; S1 real-engine evidence at `0ffc89263` (LOCAL, chromium 147.0.7727.15): 5/5. NOT claimed: firefox/webkit/M13, claim/SSR, M06+, packed consumer. |
| M06 | Met | Exit evidence recorded across M06a `9903570f1` (conditions + keyed lists, S2 browser), M06b1a-1 `05a89202b` / M06b1a-2 `70e43622f` (component references with per-read props; reusable-JSX recipes + insertion-site projections), M06b1b `3acca6e40` (chromium owner-isolation; matrix TSX-09/23), M06b2a `303637adf` / M06b2c `0ee78ec78` (children projection; list-entry item refresh for unkeyed/same-key updates), M06b2b `241c1eef7` (children-projection + unkeyed browser evidence; matrix TSX-10/26/08). Chromium 147.0.7727.15 LOCAL; unit + emitted-shape + source-map + real-engine evidence recorded above. NOT claimed: M13 three-engine qualification, TSX-04 row, nested children composition, claim/SSR (M07/M08), packed consumer, production wiring. |
| M07 | Met (per the 2026-11-12 exit amendment, §4.3) | Exit set (§4.3): M07a static-leaf structural claim (`0a97602c4`), M07b static sibling ranges (`0df1621a5`), the bounded M07b generator extension (`2dcb57871` — mount-emitted marker/order for pure static directories; D5 closed), M07-1, M07-2 (subscription evidence), M07-4 and M07-5. M07-1 is signed off on `ac8c218614e2d4749435c51edf3eaf15eb65f6fd` (Node DOM shim, 非浏览器资格; claim input is the generated mount tree after `dispose(false)`, not SSR→claim; does not fill TSX-18 or TSX-30). M07-2 (browser clean-path claim) is signed off on `70eb2381cab2ef238903cb583f3925976206e901`. Its LOCAL browser qualification is chromium 147.0.7727.15: 0 product mutations on a successful claim of the four frozen shapes, one subscription per logical dependency closed by `dispose(false)`, and focus/selection preserved on a static input. The four shapes' claim input is still the generated mount tree after `dispose(false)`. The synchronous leaf path is 「服务端 HTML 字符串 → 生成叶 claim」. This is not SSR→claim, does not fill TSX-18 or TSX-30, and does not accept update-period 0 mutation. M07-4 bounded mismatch recovery is signed off on `c4bff6dfc7efbdf2d5ad65442b82f1ccd4b3bb20`. M07-5 (the protocol record, D-2 suppression, and the three generated-leaf surfaces) is signed off on `b82e63bdfa1794897e9ddf1ef32c262f48368883` (§4.4). Under the 2026-11-12 amendment (§4.3) the M07 exit set is M07a, M07b, the bounded M07b generator extension, M07-1, M07-2 (its per-site subscription accounting is the duplicate-subscription evidence), M07-4 and M07-5. The TSX-18/TSX-30 leaf-scope cells move to M08 together with the generated-leaf SSR producer they require, so they are no longer an M07 exit item. Those rows are still not passing, and SSR→claim is still not done. The M07 exit amendment (owner-approved 2026-11-09, §4.2) moves the SSR producer/permitted seed and key alignment to M08. |
| M08 | Not met | Not started (claim + SSR for the stateful list). Load-bearing for Alpha16a exit: absorbs the SSR producer, the permitted seed-state compare, list key alignment and the TSX-18/TSX-30 leaf-scope cells. Start gate is the M07 exit sign-off (§4.4). |
| G1 (M05 exit: generated code executes in a browser at a recorded SHA) | **Recorded (signed off 2026-11-09)** | Record in §4.1: PR #1736 `70913e064`, chromium 147.0.7727.15 (LOCAL), 5/5 S1 shapes. Firefox/webkit stay M13 and are not claimed. |
| G2 (ownership/recipe evidence: two insertions, keyed replacement, disposal modes) | **Recorded (signed off 2026-11-09)** | Record in §4.1: PR #1735 `a82ef5957`, probes (a)–(e) in the `compiled-runtime` suites (LOCAL). |

**Conclusion: M01–M06 are met, including the G1/G2 gate records, and the Alpha16a
exit is still not achieved.** M07 is met under the 2026-11-12 exit amendment
(§4.3): M07a (static-leaf structural claim), M07b (private static sibling-range
directory), the bounded M07b generator extension, M07-1 (order alignment,
`ac8c218614e2d4749435c51edf3eaf15eb65f6fd`), M07-2 (browser clean-path claim,
`70eb2381cab2ef238903cb583f3925976206e901`, chromium 147.0.7727.15, LOCAL; its
per-site subscription accounting is the duplicate-subscription evidence),
M07-4 bounded mismatch recovery
(`c4bff6dfc7efbdf2d5ad65442b82f1ccd4b3bb20`) and M07-5 (protocol record,
`b82e63bdfa1794897e9ddf1ef32c262f48368883`) are recorded at fixed SHAs. The four frozen shapes still claim the
generated mount tree after `dispose(false)`; the synchronous leaf path is
「服务端 HTML 字符串 → 生成叶 claim」, which is not SSR→claim. The TSX-18/TSX-30
leaf-scope cells are M08 obligations, not M07 ones. M08 (the same stateful list
across SSR → claim → update → dispose) has not started and is the remaining
Alpha16a exit gate. No row in this ledger may be read as Alpha16a completion, a version, a
tag, a publication or a release claim. Alpha16b (M09–M14) has not started except
the bounded M14 slice in progress (PR #1748, not the M14 exit); the remaining
M07 claim chain, then M08, is still the planned spine.

### 4.1 Gate records (G1/G2) — signed off by the owner 2026-11-09

Both records follow the §2.1 template. The Lead compiled them from the drafts in
the evidence PR bodies, and the owner signed both off on 2026-11-09 (owner
decision D2, 2026-11-08). Evidence is per head (§2 rule 4): the counts belong to
the heads named below.

#### G2 — ownership/recipe evidence (M04 exit)

| Field | Record |
| --- | --- |
| Gate | G2 — ownership/recipe evidence |
| Evidence PR + squash SHA | PR #1735, squash `a82ef5957`; evidence head `a96a4327c` |
| Exact commands | `npx vitest run --project element`; `npx vitest run --project router`; `pnpm check`; frozen interface-snapshot check |
| Result summary | element 110 files / 756 tests; router 142 files / 1608 tests (extra regression); `pnpm check` 5/5; interface snapshot unchanged; PR-head CI at `c6faa05c` green (test/e2e/lint/pack/CodeQL/sha-guard). Probes: (a) two insertions are independent owners/regions/props/cleanups; (b) keyed replacement keeps DOM + instance identity, with a stale-handler negative; (c) default dispose keeps the DOM while `dispose(true)` removes it, over a throwing-cleanup matrix; (d) per-read props counts match the JSX model §4.2a (creation 0, insertion 4 reads, dependency write +3, keyed delta 2, no caching); (e) lineage accepts the definition owner and a live descendant, and rejects sibling / other tree / dead definition / dead site / deferred-after-disposal (`OE_KERNEL_DISPOSED`, `OE_KERNEL_ROOT_NOT_OWNED`). Matrix cells: none claimed by this gate (ownership probes are runtime-suite evidence). |
| Engine + revision | n/a — G2 claims no browser evidence (Node DOM harness, LOCAL) |
| What was NOT verified | browser/M13, G1/M05, codegen wiring, claim/hydration behaviour, packed consumer, class/protocol/ABI/public API |
| Classification | production (Class I) internal primitives |
| Recorder / sign-off | Lead compiled (from the PR #1735 draft); Owner signed off 2026-11-09 |
| Where recorded | this section, the §3 M04 row and the §4 exit row, all carrying the same squash SHA |

#### G1 — generated code executes in a real browser (M05 exit)

| Field | Record |
| --- | --- |
| Gate | G1 — generated code executes in a browser at a recorded SHA |
| Evidence PR + squash SHA | PR #1736, squash `70913e064`; evidence head `0ffc89263` |
| Exact commands | `npx vitest run --project compiler`; `pnpm check` |
| Result summary | compiler 34 files / 616 tests, including the 5 real-browser S1 tests; `pnpm check` 5/5; PR-head CI at `bd5fcbc48` green (test 9m29s / e2e 7m50s / lint / pack / CodeQL / sha-guard). S1 5/5: single-root mount with signal/computed + props refresh + default dispose keeps the DOM; detach dispose removes the region; multi-root/fragment authored order; empty output mounts no nodes; a throwing cleanup does not block the remaining cleanups or the region removal. The runtime under test is the real M04 module (Vite IIFE bundle), not a stub. Matrix cells: none claimed by this gate (S1 shapes are outside the semantic-test-matrix; the M06+ rows remain not run). |
| Engine + revision | chromium **147.0.7727.15** (Playwright `browser.version()`), LOCAL; firefox/webkit are M13 and are not claimed |
| What was NOT verified | firefox/webkit/M13, claim/SSR, M06+ shapes, packed consumer, production wiring, end-to-end module source map (delivered separately by M05b `896ee8fab`), class/ABI/public API |
| Classification | production (Class I) generated code, compiler-private |
| Recorder / sign-off | Lead compiled (from the PR #1736 draft); Owner signed off 2026-11-09 |
| Where recorded | this section, the §3 M05 row and the §4 exit row, all carrying the same squash SHA |

### 4.2 Owner-approved M07 exit amendment (2026-11-09)

This is a tracked amendment to how the M07 exit is read. It does not rewrite the
execution plan; the plan text stays as written and this record is the later
reading, per the amend-never-rewrite rule.

- **M07 exit set** (leaf-scope): M07a static-leaf claim core, M07b static
  sibling-range directory, the bounded M07b generator extension, composition /
  repeated-insertion order alignment, bounded mismatch recovery (M07-4),
  duplicate-subscription accounting, and the M07 protocol decision record
  (M07-5) plus the TSX-18/TSX-30 leaf-scope cells.
- **Moved to M08** (owner decision, 2026-11-09): the generated-leaf SSR
  producer and the permitted seed-state compare (the plan's "permitted seed
  state" is read as the M08 SSR→claim parity obligation for the same stateful
  list) and list key alignment (M07 keeps repeated-insertion order alignment
  only). This is a scheduling/evidence-attribution change, not a relaxation of
  the claim-chain obligation: the same chain is still proved on the stateful
  list in M08, and TSX-18/TSX-30 are still recorded there.
- **Not changed by this amendment**: the marker/seed/diagnostic private
  contract stays OPEN and unapproved (R4 "Owner decision?" remains `No`); the
  ABI/public-surface freeze stays Alpha17; Alpha16a still creates no version,
  tag, publication or release claim.

### 4.3 Owner decision 2026-11-12: M07 exit amendment (closeout)

This is a tracked amendment to how the M07 exit is read, in the same
amend-never-rewrite form as §4.2. It does not rewrite the execution plan or
§4.2; it is the later reading of the one open definitional gap.

- **Decision (owner, 2026-11-12).** Two items in the §4.2 exit set are not
  independently provable at leaf scope:
  1. **TSX-18 / TSX-30 leaf-scope cells.** The semantic-test-matrix defines the
     `K` column as "claim on existing SSR DOM" and the `S` column as SSR. Since
     §4.2 (2026-11-09) moved the generated-leaf SSR producer and the permitted
     seed-state compare to M08, a legal `K`/`S` cell cannot be produced inside
     M07. The obligation therefore moves to M08 with the producer it depends on;
     the cells stay unfilled and are recorded as M08 exit obligations.
  2. **Duplicate-subscription accounting.** The recorded evidence already
     exists in signed slices: M07-2's per-site subscription accounting (one
     subscription per logical dependency, closed by `dispose(false)`) and
     M07-4's release/re-subscribe assertions on a failed claim. It is evidence
     for the M07 exit set rather than a separate slice needing its own
     sign-off record.
- **Resulting M07 exit set.** M07a, M07b, the bounded M07b generator extension,
  composition / repeated-insertion order alignment (M07-1), the browser
  clean-path claim (M07-2, as the subscription evidence), bounded mismatch
  recovery (M07-4) and the M07 protocol record (M07-5).
- **What this does not do.** It does not relax the claim chain, does not fill
  TSX-18/TSX-30, does not accept an update-period zero-mutation result, and does
  not turn M07 into an Alpha16a exit: Alpha16a still requires M08. It does not
  change the marker/seed/diagnostic private-contract status (still OPEN), the
  ABI freeze milestone (Alpha17), or the no-version/no-tag/no-release rule.

### 4.4 Owner decisions 2026-11-12: M07-5 sign-off, closeout form, M08 start gate

- **M07-5 signed off on `b82e63bdfa1794897e9ddf1ef32c262f48368883`** (PR #1757 merge commit; PR head
  `e6e222418bb129c574179352a7148c0a67f5c7b0`). Fixed-head QA at that tree:
  `pnpm exec vitest run --project compiler --project element` → 152 files /
  1529 tests passed (includes the M07-2 chromium suite, `error-dialect`, and
  `static-sibling-ranges`); `pnpm run check` 5/5; `interface:snapshot` matches
  (6 packages, public surface unchanged); `docs-index:check` (21 active /
  8 historical / 11 archive-removal entries); `check:doc-claims`;
  `check-agent-contract`. CI on the PR head: AutoFlow CI run 43157697142
  (lint/test/e2e/pack pass), CodeQL 43157697129, Code Quality 43157693837.
  Qualification boundary: the M07-5 fixtures are Node DOM shim (非浏览器资格);
  the browser evidence is the chromium-only M07-2 suite, not M13.
- **Closeout form (adopted).** A milestone sign-off is recorded once, by a
  consolidation PR that names the fixed SHA and carries its own evidence, and
  never as a by-product of a WIP slice PR. M07-1/M07-2/M07-4 were recorded by
  later PRs under that form; this PR records M07-5 and the M07 exit.
- **M08 start gate.** M08 starts only after this M07 exit sign-off and an owner
  scope authorization. Its input set is frozen: the M06 stateful-list generator,
  the M07 claim chain, the SSR producer, the permitted seed-state compare and
  list key alignment (§4.2), plus the TSX-18/TSX-30 leaf-scope cells (§4.3).
  Acceptance: per-phase equivalence (S/K/U/D), claim negative cases
  (mismatch/recovery/input-focus), the full TSX-18/TSX-30 rows, and a failed
  claim-fidelity proof triggers the stop condition (execution plan §10 #3)
  rather than a silent continuation into Alpha16b.
- **P0 formalization pilot.** Runs in parallel (1–2 week kill gate); it does not
  block the M08 start gate.

## 5. 2026-11-03 audit closure register

Source ledger: the 2026-11-03 audit ledger at baseline `ace820a74` (#1699),
re-verified 2026-11-08 against `ec09d444e`. The verdicts below are static-file
verdicts from that re-check; the re-check ran no suite and no benchmark. Rows
marked "this change set" are fixed by the Track C change set that carries this
ledger and close when that change set merges; their evidence is the diff in
that PR, not a claim in this file.

| Item | Verdict | Evidence | Close condition / next action |
| --- | --- | --- | --- |
| A-01 release:check mis-described as read-only | **Fixed** | `docs/agent-contract.md` — the `release:check` row says "local writes + network; not read-only", and the paragraph below it says it writes local artifacts and uses the network. Fixed by #1708 `cb9d6d243`. | Closed. |
| A-02 protocol "types-only" description untrue | **Fixed** | `packages/protocol/src/diagnostics.ts` header ("zero-dependency contracts plus small pure runtime parsing/validation utilities") and `docs/agent-contract.md`'s protocol paragraph. Fixed by #1702 `4f1f2001b`. | Closed. |
| A-03 README "only TypeScript dependency" claim wrong | **Fixed** | `README.md` "Repository shape": TypeScript lives in the Element split while Router tooling also depends on TypeScript; `packages/router/package.json` carries the TypeScript dependency. Fixed by #1702 `4f1f2001b`. | Closed. |
| A-04 ParserPort "replacement" promise too strong | **Fixed** | `packages/compiler/src/internal/compiler/semantic-core/parse-module.ts` header now says ParserPort is not a backend-neutral AST boundary and does not establish a one-file backend swap. Fixed by #1702 `4f1f2001b`. | Closed. |
| A-05 benchmark defect comment stale | **Fixed in this change set** | `benchmarks/micro/micro.ts` header (this PR): the stale "test-only serializeToHtml diverges for multi-field each Blocks" claim is replaced with the current truth — both paths delegate the walk to the shared kernel since #1469, the seed seam resolves each item slot's field, and the seed path still differs from the server path, so the benchmark enters through the canonical server serializer. | Close on merge; the corrected comment is the whole fix. |
| B-01 seed serializer vs canonical SSR duplication | **Still present** | `packages/element/src/internal/compiled/runtime.ts` still exposes `seedSerializerSeams` and a local `serializeToHtml`; the canonical server serializer is `packages/element/src/internal/compiled/server/index.ts`; `packages/element/__tests__/compiled-hydration/hydrate-harness.ts` consumes the seed path. | Needs a consumer migration (or retirement of the seed seam behind one shared walker) with its own tests. Not a comment fix; not in this change set. |
| B-02 semantic-core boundary test blind spots | **Fixed in this change set** | `packages/element/__tests__/compiler-semantic-core-boundary.test.ts` (this PR) now scans static import/export specifiers, `import x = require(...)`, and literal `import()`/`require()` specifiers; a non-literal dynamic specifier is carried as a fail-closed marker; negative fixtures exercise the refusal. | Close on merge; the expanded suite is the evidence. |
| B-03 RuntimeAdapter type duplication | **Still present** | `packages/protocol/src/runtime.ts` declares `RuntimeAdapter` and `RuntimeAdapterOptions` with duplicated fields; `packages/element/src/internal/core/runtime.ts` copies every field in `createRuntimeAdapter`. | Deduplication changes a public type: it needs its own PR, an interface snapshot update (`interface:snapshot:write`) and — if the decision is hard to reverse — an ADR. Not in this change set. |
| C-01 Lit renderer retirement | **Executed (zero compatibility, 2026-11-08)** | Closing change set on `lit/zero-compat-retirement`: source cutover `800c4e390`, proof-surface removal `c236387` (this docs/ledger commit closes the row). `packages/router/package.json` no longer exports `./lit` / `./lit-ssr`; `packages/router/src/lit.ts` and `lit-ssr.ts` are deleted; `renderer: 'lit'` fails with an explicit `CONFIG_INVALID` migration error; `docs/architecture/shim-inventory.md` shims #8 and #17 are recorded as 已删; `ADR-0152` (2026-11-08 amendment) remains the authority. | Closed — no compatibility window, adapter or dual renderer lane was shipped. Evidence: `pnpm check` 5/5; router vitest 142 files / 1608 tests; element 105 / 720; compiler 331; tools 64 / 645; native fixture e2e 53 × chromium/firefox/webkit = 159 passed; the public interface snapshot was regenerated to the narrowed surface. Not attached to an Alpha16 M-row PR. |
| KEEP (5 spot checks) | **Not deleted** | `packages/element/src/internal/compiled/runtime/fresh-dom.ts`; the fail-closed guard in `packages/element/src/jsx-runtime.ts`; the runtime `__partProgram` detection in `packages/router/src/authoring.ts`; `packages/element/src/internal/core/security.ts`; the third-party WC/CEM rows in `docs/architecture/shim-inventory.md`. | Re-verify at each audit. No action. |

## 6. Related records

- Authority: [Alpha16–18 execution plan](./alpha16-18-execution-plan.md).
- M05 prototype claim boundary: [M05 leaf-codegen prototype](./m05-g1-leaf-prototype.md).
- Dependency triage (C5): [dependency-alerts-2026-11-06](../release/dependency-alerts-2026-11-06.md).
- Process hardening (C7): `CONTRIBUTING.md` § Completion, CI and evidence policy and `.github/PULL_REQUEST_TEMPLATE.md`.
- Execution model (C8): [docs/agent-contract.md](../agent-contract.md#session-execution-model-owner-ruling-2026-09-21).

## 7. Updating this ledger

1. The slice PR that changes a milestone updates the row in the same change —
   status, evidence PR/SHA, and a one-line note with the command(s) and result
   summary. Do not batch status updates into a later docs PR.
2. A row turns `complete` only when the execution-plan exit evidence exists at a
   recorded SHA; a merged prototype never flips it.
3. G1/G2 rows are filled only from qualifying evidence recorded per head, never
   from prototype output or a green CI run.
4. When a closure-register row closes, keep the row (with the closing PR/SHA)
   instead of deleting it; the register is the audit trail. New audit items are
   appended with the same columns.
