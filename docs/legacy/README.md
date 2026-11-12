# Legacy

This directory is the **read-only archive and removal register** of the
repository. Nothing here governs current work: the current view is the generated
[architecture index](../architecture/README.md), decisions are registered in the
[ADR index](../adr/README.md), and this page is generated from
[`docs/history.json`](../history.json) by
`@openelement/tools-repo#docs-index:write`.

## Why it exists

Active records stay in `docs/adr/`; records that no longer govern are moved here
so the main line carries only what is in force. Moving is not deletion: the full
text of every archived record is preserved, and Git history retains the path it
came from. Process documents that are not decision records are not archived —
they are removed from the main line and registered in the same place.

<!-- gen:begin docs-legacy-register -->

## Archived decision records

| Record | Status | Carried | Recover at `826dead` |
| --- | --- | --- | --- |
| [ADR-0108: npm distribution via `deno pack`](./adr/ADR-0108-deno-native-npm-distribution.md) | SUPERSEDED by ADR-0161 | Deno-native npm distribution: a Deno workspace whose public packages ship as ordinary npm artifacts via the `deno pack` tarball generator; the Deno-native toolchain and consumer requirement are retired and the npm-only publishing half is restated in ADR-0161. | `docs/adr/ADR-0108-deno-native-npm-distribution.md` |
| [ADR-0112: Protocol Types and Tiny Runtime](./adr/ADR-0112-protocol-types-and-tiny-runtime.md) | SUPERSEDED by ADR-0152 | Standalone `@openelement/protocol` contracts package with a tiny runtime; the package left the tree at v0.40.0 and the shared contract types now live inside `@openelement/element`, whose multi-package boundary was superseded by ADR-0152. | `docs/adr/ADR-0112-protocol-types-and-tiny-runtime.md` |
| [ADR-0156: Tree-SHA evidence reuse for the candidate gate](./adr/ADR-0156-tree-sha-evidence-reuse.md) | RETIRED by the #1567 CI/Release redesign | Tree-SHA evidence reuse for the candidate gate: a reuse chain judged by the producer's tree, with a refused claim falling back to the real gate; the mechanism was removed by the #1567 CI/Release redesign. | `docs/adr/ADR-0156-tree-sha-evidence-reuse.md` |
| [ADR-0162: Element runtime/compiler package split — executed](./adr/ADR-0162-element-runtime-compiler-split-deferred.md) | EXECUTED: the deferred split landed | Deferral of the Element runtime/compiler package split until measured evidence justified it; the split has since landed and the record is closed as executed. | `docs/adr/ADR-0162-element-runtime-compiler-split-deferred.md` |

## Removed process documents

| Document | Removed | What it carried | Where that responsibility lives now | Recover at `826dead` |
| --- | --- | --- | --- | --- |
| `docs/architecture/alpha16-18-architecture-audit.md` | 2026-11-10 | READ-ONLY audit of the alpha.15 tree: what it implements, the gap the target must close, the historical compatibility constraints it inherits and the coverage boundary of the evidence. | [Canonical target architecture](../architecture/compiler-native-architecture.md), [Milestone status and evidence ledger](../architecture/alpha16-18-progress.md) (partial: no successor carries the full responsibility) | `docs/architecture/alpha16-18-architecture-audit.md` |
| `docs/architecture/alpha16-18-cleanup-inventory.md` | 2026-11-10 | APPROVED POLICY inventory of every cleanup and migration object: KEEP / REFACTOR / REPLACE / RETIRE-after-qualification rows with named consumers, blockers and exit criteria, and the rule that nothing may be deleted from this list alone. | **No in-tree successor**; recover from Git history | `docs/architecture/alpha16-18-cleanup-inventory.md` |
| `docs/architecture/alpha16-18-current-reality.md` | 2026-11-10 | READ-ONLY audit of the 2026-11-03 reality and contradiction matrices, the boundary answers, the `__partProgram` production consumer map, the approved D-O1…D-O3 owner decisions and the remaining OPEN register O-1…O-10. | [Consumer migration matrix](../architecture/m01-consumer-migration-matrix.md), [Product scope and accepted direction](../architecture/product-model.md), [ADR-0174: Generated code, shared runtime and compatibility](../adr/ADR-0174-generated-code-runtime-and-compatibility.md) (partial: no successor carries the full responsibility) | `docs/architecture/alpha16-18-current-reality.md` |
| `docs/architecture/alpha16-18-fourth-pass-reassessment.md` | 2026-11-10 | APPROVED 2026-11-03 decision package P-1…P-5: retire the Class authoring API and Part Program v2 as a serialized protocol, remove `__partProgram` from the target generated-module ABI, retire the old validator/version, and build no authoring adapter — with the cost and option analysis behind it. | [Canonical target architecture](../architecture/compiler-native-architecture.md), [Stage authority (M01–M14)](../architecture/alpha16-18-execution-plan.md), [ADR-0173: Component execution and composition](../adr/ADR-0173-component-execution-and-composition.md), [ADR-0174: Generated code, shared runtime and compatibility](../adr/ADR-0174-generated-code-runtime-and-compatibility.md) (partial: no successor carries the full responsibility) | `docs/architecture/alpha16-18-fourth-pass-reassessment.md` |
| `docs/architecture/alpha16-18-freeze-audit.md` | 2026-11-10 | The Alpha16–18 freeze gate: full chain map, source coverage ledger, consumer-matrix summary, contradiction register FR-01…FR-16, the remaining OPEN engineering register and the Alpha16a freeze statement. | **No in-tree successor**; recover from Git history | `docs/architecture/alpha16-18-freeze-audit.md` |
| `docs/architecture/alpha16-18-retirement-roadmap.md` | 2026-11-10 | APPROVED POLICY retirement roadmap: per-object KEEP / REFACTOR / REPLACE / RETIRE disposition matrix with consumers and deletion preconditions, the phased Alpha16–18 plan, the Alpha16b class-retirement capability gate and the required evidence per retirement action. | **No in-tree successor**; recover from Git history | `docs/architecture/alpha16-18-retirement-roadmap.md` |
| `docs/architecture/alpha16-integration-workboard.md` | 2026-11-10 | Coordination record: the M07 adjudications, the decided M07b technical plan (§13), evidence grades, merge order and the 2026-11-09 §14 Lead/QA acceptance. | [Milestone status and evidence ledger](../architecture/alpha16-18-progress.md) (partial: no successor carries the full responsibility) | `docs/architecture/alpha16-integration-workboard.md` |
| `docs/maintainers/agent-contract.md` | 2026-10-20 | The internal maintainers copy of the agent development contract: the canonical commands, the generated-file map, gate semantics and diagnostics consumption, every claim mechanically checked by tools/repo/check-agent-contract.ts. | [Agent and gate contract](../agent-contract.md) | `docs/maintainers/agent-contract.md` |
| `docs/maintainers/alpha16-candidates.md` | 2026-10-20 | The committed X-id register of alpha15 residual work the alpha15 release PR referred to; entries named where their evidence lived. The working copy stayed outside the repository. | **No in-tree successor**; recover from Git history | `docs/maintainers/alpha16-candidates.md` |
| `docs/maintainers/known-reds-ledger.md` | 2026-10-20 | The committed view of the known-reds ledger: entries that make a gate red or bound what a gate can prove, each with symptom, evidence path, impact, owner, retirement condition and latest observation; status vocabulary OPEN / FIXING / FIXED / COVERED-BY-DESIGN. | **No in-tree successor**; recover from Git history | `docs/maintainers/known-reds-ledger.md` |
| `docs/release/alpha15-retrospective.md` | 2026-10-20 | The release/evidence lane's retrospective for the alpha15 cleanup batch: the decisions taken, each pointing at the lane evidence file or ADR that is the authority instead of re-narrating them. | **No in-tree successor**; recover from Git history | `docs/release/alpha15-retrospective.md` |

Recovery is the pre-change path at the baseline commit: `git show <baseline>:<path>` for both
the archived records and the removed documents. The register is machine-checked by
`@openelement/tools-repo#docs-index:check`; a deletion that is not registered here fails the gate.

<!-- gen:end docs-legacy-register -->

## Rules

1. Archived records are never edited and never cited as an active requirement. A
   citation that points here must say the record is retired.
2. Every archived file and every removed document is registered in
   `docs/history.json` in the change that moves or removes it. The register is
   the authority; this page is generated. `docs-index:check` (in `gate:source`)
   fails on an unregistered deletion.
3. Recovery is the pre-change path at the register's baseline commit:
   `git show <baselineCommit>:<path>`. A removed document does not live anywhere
   in the tree.
4. Archived records keep their authored text byte-for-byte, including relative
   links written for their former directory. A sibling link may therefore not
   resolve from here; reach the target through the ADR index or Git history.
   Never edit an archived record to repair a link.
