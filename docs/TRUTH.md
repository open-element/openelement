# Current truth

This is the single entry point for **what is in force right now**. Each topic
below has exactly one active document. Anything not listed here is either
archived in [`docs/legacy/`](./legacy/README.md) or removed into Git history;
neither governs current work.

Owner ruling 2026-11-10: the previous practice of keeping every superseded
reading beside its successor is replaced by physical separation. Active
documents stay on the main line, closed ADRs are archived, and process
documents are removed. A later decision is recorded here; it is not appended as
an amendment to the old text.

## 1. Active documents

| Topic | Active document | Notes |
| --- | --- | --- |
| Stage authority, M01–M14, exit sets | [`alpha16-18-execution-plan.md`](./architecture/alpha16-18-execution-plan.md) | The dependency spine is authoritative; it defines gates, not dates. |
| Milestone status and evidence ledger | [`alpha16-18-progress.md`](./architecture/alpha16-18-progress.md) | One row per milestone; evidence is PR + squash SHA + commands + result. |
| Semantic evidence grid | [`alpha16-18-semantic-test-matrix.md`](./architecture/alpha16-18-semantic-test-matrix.md) | A case is done only when its required cells carry a recorded result at a recorded SHA. |
| Product scope and accepted direction | [`product-model.md`](./architecture/product-model.md) | Two public products: Element and Router. |
| Canonical target architecture | [`compiler-native-architecture.md`](./architecture/compiler-native-architecture.md) | P1–P5 and the responsibility split. |
| Compiler IR and ABI boundary | [`compiler-ir-and-abi-boundary.md`](./architecture/compiler-ir-and-abi-boundary.md) | M01 layer map; ABI freeze belongs to Alpha17. |
| Author contract | [`tsx-author-candidate-contract.md`](./architecture/tsx-author-candidate-contract.md) | 30 review cases; candidate APIs are unreleased. |
| JSX values and repeatable children | [`jsx-value-and-children-model.md`](./architecture/jsx-value-and-children-model.md) | Owner/region model and disposal contract. |
| Active decision records | [`adr/README.md`](./adr/README.md) | Index of active ADRs; closed records are in `legacy/adr/`. |
| Agent and gate contract | [`agent-contract.md`](./agent-contract.md) | Canonical commands, generated surfaces, gate semantics. |
| Cross-system seams | [`seams.md`](./architecture/seams.md) | Registered with consumer-form tests. |
| Shim inventory | [`shim-inventory.md`](./architecture/shim-inventory.md) | Machine-read by `shims:check`. |
| Release state | [`release/release-state.json`](./release/release-state.json) | Registry truth; `commonCompleteVersion` is `null`. |

Design and evidence documents (`m01-`…`m07b-` notes, `compiler-and-element-runtime.md`,
`rendering-and-hydration.md`, `router-and-server-runtime.md`,
`packages-and-distribution.md`, `security-and-release-engineering.md`) remain
active because the ledger and the matrix cite them as evidence.

## 2. Owner decisions (2026-11-10)

| ID | Decision | Layer |
| --- | --- | --- |
| **D-1** | **M07 claim failure allows bounded retry.** A failed claim must release the reservation, roll back committed range tombstones and the success cursor, and release owners/cleanups, so the same parent can be claimed again. Borrowed SSR nodes are never deleted; whole-claim byte restoration remains out of scope. | Behavior |
| **D-2** | **Suppress mount-only markers.** The generator emits `oe:r:` / `oe:/r:` marker pairs only when a claim function is emitted for that tree. Pure-mount trees carry no inert comment nodes. The marker/seed private contract stays OPEN until M08 introduces a real SSR producer. | Behavior |
| **D-3** | **Single source of truth by physical separation.** Closed ADRs are archived in `docs/legacy/adr/`; process documents are removed from the main line into Git history; this file is the only current-read entry. | Governance |

D-1 and D-2 change observable behavior and require evidence at a recorded SHA.
D-3 is a record-layer change; no runtime behavior is affected.

Still owned by the owner, not delegated: M-row / G1 / G2 sign-off, independent
QA fixed-head review, execution-plan amendments, and any version / tag /
publication. Alpha16a creates none of the latter.

## 3. Archived — closed ADRs

Four records (`ADR-0108`, `ADR-0112`, `ADR-0156`, `ADR-0162`) live in
[`docs/legacy/adr/`](./legacy/adr/). Their entries stay in the ADR index with
`SUPERSEDED` / `RETIRED` / `EXECUTED` annotations, and
`tools/repo/check-adr-index.ts` reads both directories so `gate:source` still
covers them.

## 4. Removed — process documents (2026-11-10)

These were removed from the main line rather than archived; recover any of them
from Git history with `git log --diff-filter=D -- <path>` followed by
`git show <commit>^:<path>`:

- `docs/architecture/alpha16-18-architecture-audit.md`
- `docs/architecture/alpha16-18-cleanup-inventory.md`
- `docs/architecture/alpha16-18-current-reality.md`
- `docs/architecture/alpha16-18-fourth-pass-reassessment.md`
- `docs/architecture/alpha16-18-freeze-audit.md`
- `docs/architecture/alpha16-18-retirement-roadmap.md`
- `docs/architecture/alpha16-integration-workboard.md`

Every former citation now says the target was retired into Git history, per
`docs/adr/README.md` rule 4.

### What each removed document carried

| Removed document | What it carried | Where that responsibility lives now |
| --- | --- | --- |
| `alpha16-18-architecture-audit.md` | READ-ONLY audit of the alpha.15 tree: what it implements, the gap, compatibility constraints, coverage boundary | `compiler-native-architecture.md` (canonical target), `alpha16-18-progress.md` (status) |
| `alpha16-18-cleanup-inventory.md` | **APPROVED POLICY**: KEEP / REFACTOR / REPLACE / RETIRE rows with named consumers, and the rule that no deletion happens from the list alone | `seams.md`, `shim-inventory.md`, and rule 2 below |
| `alpha16-18-current-reality.md` | READ-ONLY audit: reality matrix, contradiction matrix, boundary answers, `__partProgram` consumer map, owner decisions 2026-11-03, remaining OPEN items | `product-model.md`, `compiler-ir-and-abi-boundary.md`, §2 above |
| `alpha16-18-fourth-pass-reassessment.md` | **APPROVED DECISION PACKAGE P-1…P-5**: Class API and Part Program retirement, generated-module ABI, two backends, milestone updates | `compiler-native-architecture.md`, `ADR-0173`, `ADR-0174` |
| `alpha16-18-freeze-audit.md` | Chain map, source coverage ledger, consumer matrix, contradiction register FR-01…FR-16, freeze statement | `alpha16-18-execution-plan.md`, `alpha16-18-semantic-test-matrix.md` |
| `alpha16-18-retirement-roadmap.md` | **APPROVED POLICY**: disposition matrix, phased roadmap, required evidence per retirement action | `alpha16-18-execution-plan.md` §12a (M10 evidence) |
| `alpha16-integration-workboard.md` | Coordination record: M07 adjudications, decided M07b technical plan, evidence grades, merge order, and the 2026-11-09 §14 Lead/QA acceptance | `alpha16-18-progress.md` §4.2 (owner-approved M07 exit amendment), §2 above |

Three of these (`cleanup-inventory`, `fourth-pass-reassessment`,
`retirement-roadmap`) were approved policy or decision packages, not expired
drafts. The owner accepted on 2026-11-10 that their in-tree rationale is traded
away in exchange for a single active main line; their conclusions are
summarised above and their full text remains recoverable from Git history.

## 5. Rules

1. Exactly one active document per topic. A second active statement of the same
   topic is a defect, not a second opinion.
2. `docs/legacy/` is read-only and is never cited as an active requirement.
3. A change that alters which document is active updates this file in the same
   commit.
4. Prototypes never count as completion; green CI never counts as browser
   qualification; Alpha16a creates no version, tag, publication or release
   claim.
