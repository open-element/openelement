# Alpha16–18 progress ledger and audit closure register

Date: 2026-11-08. Baseline: `origin/main` =
`5649d9770c94e67d67c6d7401e0897dfe0c6e990` (PR #1720, merged 2026-11-08); the
2026-11-03 audit closure register in §5 is re-verified against the same tree.

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
| M06 | I | In progress — M06a + M06b1a-1 + M06b1a-2 merged; M06b1b owner-isolation browser evidence and M06b2 children projection pending | #1738 `9903570f1` (M06a conditions + lists/keyed reorder + S2 browser evidence; squash SHA), #1739 `05a89202b` (M06b1a-1 module-level component mounts + component references; squash SHA), #1740 `6716cfb2b` (M06b1a-2 reusable JSX recipes + insertion sites; evidence head — squash SHA pinned by the next slice) | **M06a** widens the compiler-private generated-leaf v2 generator for the stateful hostless list: conditions (comment anchor + generated branch builders, per-branch `LifetimeScope`, `removeNodes` range cleanup, `dispose(true)` replacement, rollback/rethrow on a throwing branch) and lists (per-entry owners/regions, generated key thunk, keyed reuse with in-place `update`, insert/delete/unkeyed/multi/empty root, subscription to the items/key outer reads, disposal of removed entries, minimal-move keyed placement) — all through the merged M04 primitives; `key` is consumed as list identity, never a DOM write. S2 real-browser evidence at `74f7badc0` (LOCAL, chromium 147.0.7727.15, real M04 runtime bundle): keyed reorder preserves DOM node identity, private-draft write keeps entry identity, delete/insert closes removed-entry subscriptions (`runtimeProbe` delta), condition toggle replaces branches without leaking, focus + selection survive keyed reorder, throwing branch surfaces the error and recovers. The module source map covers the new emitted shapes (placements decode through the pinned `@jridgewell/trace-mapping@0.3.31`). Evidence: `npx vitest run --project compiler` → 35 files / 632 tests passed (626 pre-existing + 6 new/updated); `pnpm check` PASS; doc/registry gates green; PR-head CI recorded in the PR body. **M06b1a-1** (#1739, evidence head `d0acc21c4`, LOCAL) emits one module-level `function <Name>__mount(scope, props, host)` per component (the exported `create<Name>Recipe(owner, host)` factory keeps its name/signature and delegates) and admits module-local component references (`<Child prop={expr}/>`) with a per-read prop getter record over the defining parent scope, a `host.propDeps` refresh channel (root factory: `[host.propsChanged]`; reference site: the parent bindings behind the passed prop expressions), a fresh child scope with `dispose(true)` rollback + range cleanup, and authored order; component chunks are line-rebased for the module source map. New fail-closed codes: `OEIR_LEAF_UNKNOWN_COMPONENT` (external/unknown), `OEIR_LEAF_COMPONENT_CYCLE` (reference-graph DFS with the cycle path, checked before emission), `OEIR_LEAF_UNSUPPORTED_COMPONENT` (child with no named props parameter, child owning signal/computed resources, `children` prop, component reference inside a list entry template pending the M06b1b child update hook); `class`/`style`/`innerHTML`/`event`/`ref` prop channels reuse `OEIR_LEAF_UNSUPPORTED_ATTRIBUTE`. Evidence at that head: `npx vitest run --project compiler` → 35 files / 650 tests passed (LOCAL; the pre-existing 9 chromium S1/S2 browser tests re-ran as regression, no new browser claim); `pnpm check` 5/5; pre-push gate set passed; PR-head CI in the PR body. **M06b1a-2** (#1740, evidence head `6716cfb2b`, LOCAL) admits reusable JSX values: `FunctionModelResource.recipeId` links a direct component-local JSX initializer to its recipe (plain model metadata; the generator never re-derives the link), `{name}` slots become `insertion-site` nodes (an enclosing list-mapper parameter shadows the component local), the generator emits one inline `createRecipe` per referenced value with its own recipe scope and one temp-`DocumentFragment` + `insertRecipe` projection per site whose `projection.nodes` are spread into the enclosing sink in authored order, and the M06b1a-1 cycle DFS is generalised to a mount graph over components and recipes (`OEIR_LEAF_RECIPE_CYCLE`). Unsupported shapes stay refused with `OEIR_LEAF_UNSUPPORTED_RECIPE` (JSX lowered inside a non-initializer expression, a reusable value read as an expression value, an insertion site not targeting a direct initializer) plus the defensive `OEIR_LEAF_MISSING_RECIPE`. Evidence at that head: `npx vitest run --project compiler` → 35 files / 664 tests passed (LOCAL, 650 baseline + 14 new; no browser claim); `pnpm check` 5/5; pre-push gate set passed; PR-head CI in the PR body. NOT claimed: M06 completion (M06b1b owner-isolation browser evidence TSX-09/23 and M06b2 children projection TSX-10/26 remain), M07/M08 claim/SSR, browser/M13, unkeyed browser scenario (unit/source-map only), production wiring, packed consumer. |
| M07 | I | Not started | — | Generated leaf claim; depends on M05. |
| M08 | I | Not started | — | Claim + SSR for the stateful list; depends on M06/M07. |
| M09 | I | Not started | — | Alpha16b: generated Native Custom Element boundary. |
| M10 | I→Q | Not started | — | Alpha16b: legacy-consumer migration and retirement evidence; five separate proofs per §12a. |
| M10a | Q | Not started | — | Alpha16b early, non-gating smoke. The prototype's consumer test is M10a-shaped only and is explicitly not M10a/M12 qualification. |
| M11 | I | Not started | — | Alpha16b: Router integration for the generated path. |
| M12 | Q | Not started | — | Alpha16b: final packed-consumer qualification of the stateful list. |
| M13 | Q | Not started | — | Alpha16b: three-engine browser + server qualification at an exact SHA. The three engines belong here, not to G1. |
| M14 | I | Not started | — | Alpha16b: async server components, full-await. |

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
| M06 | Not met | In progress — M06a #1738 `9903570f1`, M06b1a-1 #1739 `05a89202b`, M06b1a-2 #1740 `6716cfb2b`. M06b1b owner-isolation browser evidence (TSX-09/23) and M06b2 children projection (TSX-10/26) remain pending. |
| M07 | Not met | Not started (generated leaf claim). |
| M08 | Not met | Not started (claim + SSR for the stateful list). |
| G1 (M05 exit: generated code executes in a browser at a recorded SHA) | **Recorded (signed off 2026-11-09)** | Record in §4.1: PR #1736 `70913e064`, chromium 147.0.7727.15 (LOCAL), 5/5 S1 shapes. Firefox/webkit stay M13 and are not claimed. |
| G2 (ownership/recipe evidence: two insertions, keyed replacement, disposal modes) | **Recorded (signed off 2026-11-09)** | Record in §4.1: PR #1735 `a82ef5957`, probes (a)–(e) in the `compiled-runtime` suites (LOCAL). |

**Conclusion: M01–M05 are met, including the G1/G2 gate records, and the Alpha16a
exit is still not achieved.** M06–M08 remain pending. No row in this ledger may
be read as Alpha16a completion, a version, a tag, a publication or a release
claim. Alpha16b (M09–M14) has not started; the next planned work is the M06b
generated-composition slices, then the M07 → M08 claim/SSR spine.

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
