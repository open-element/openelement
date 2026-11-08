# Alpha16–18 progress ledger and audit closure register

Date: 2026-11-08. Baseline: `origin/main` =
`ec09d444e65c4773c0b6d5ac097bce54b0497d0f` (PR #1719, merged 2026-11-08); the
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
| M02 | I | In progress — spike merged, exit not met | #1705 `017bd3e87` (2026-11-03) | The [M02 report](./m02-semantic-ir-feasibility.md) proves the IR can express the five worked examples. Measured against execution-plan §1a: criteria 1/2/3/5/6 are met, and the only remaining exit gap is §1a criterion 4 — the admitted `condition` node has no negative case (`OEIR_CONDITION_BRANCH_UNSUPPORTED` exists at `packages/compiler/src/internal/compiler/semantic-ir/build.ts:456-468` but has no test). The §9 OPEN list does not block the exit: OPEN-1/2/6 are M03 work, OPEN-5 is M04 work and OPEN-4 (claim marker) is explicitly allowed to stay OPEN in M02 by §1a criterion 3. The next slice adds the negative case and flips this row to complete. |
| M03 | I | In progress — design and I-0 prototype merged, implementation not started | #1706 `463e6cb07` (design), #1707 `e23420d3a` (M03-I-0) | [M03-A](./m03-scope-resolution.md) and [M03-B](./m03-expression-identity.md) are DESIGN PROPOSAL — NOT IMPLEMENTED; [M03-I-0](./m03-i0-sourcemap-prototype.md) is a PROTOTYPE + DECISION. No resolver, erasure, identity or end-to-end source-map implementation exists, so Alpha15 diagnostics/Source-Map/security parity is not met. |
| M04 | P→I | Not started | — | No ownership or recipe primitives. G2 is not recorded. |
| M05 | I | In progress — Class P prototype merged; **NOT G1**; M05 not complete | #1709 `4f9821527` (2026-11-06) | The compiler-private leaf-codegen prototype is real-DOM mechanism evidence only. M03 and M04 are absent, so the M05 exit (G1) cannot be recorded. PR #1709's merged body records the head's local evidence: compiler project 331 tests, semantic-ir 130 tests, chromium 7/7 and firefox 7/7 real-DOM cases, consumer smoke 1/1; WebKit was left to CI and is not claimed. See [the prototype record](./m05-g1-leaf-prototype.md) for supported/refused shapes and the not-claimed list. |
| M06 | I | Not started | — | Stateful hostless list; depends on M05. |
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
| M02 | Not met | Feasibility spike only; §1a criteria 1/2/3/5/6 are met and the only remaining gap is criterion 4 — the admitted `condition` node has no negative case. The §9 OPEN list does not block the exit: OPEN-1/2/6 are M03 work, OPEN-5 is M04 work and OPEN-4 is allowed OPEN in M02 by §1a criterion 3. |
| M03 | Not met | Design + source-map prototype only; no function-component frontend, erasure, identity or source maps. |
| M04 | Not met | Not started; no ownership/recipe primitives. |
| M05 | Not met | Class P prototype only; M03/M04 prerequisites absent. |
| M06 | Not met | Not started. |
| M07 | Not met | Not started. |
| M08 | Not met | Not started. |
| G1 (M05 exit: generated code executes in a browser at a recorded SHA) | **Not recorded** | The only browser evidence is the prototype; it is not a G1 record (see [prototype record §7](./m05-g1-leaf-prototype.md#7-not-claimed)). |
| G2 (ownership/recipe evidence: two insertions, keyed replacement, disposal modes) | **Not recorded** | M04 is not started, so there is no implementation to record against. |

**Conclusion: Alpha16a exit is not achieved.** No row in this ledger may be read
as Alpha16a completion, a version, a tag, a publication or a release claim.
Alpha16b (M09–M14) has not started; the next planned work is the M03 → M04 →
M05 v2 spine.

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
