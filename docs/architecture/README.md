# Architecture

OpenElement has two public products: Element and Router. The remaining packages
adapt, scaffold, build, and distribute those products.

- [Design principles](./design-principles.md) ([中文](./design-principles.zh.md))
- [Product model and 2026-11-03 direction](./product-model.md)
- [**Compiler IR and ABI boundary (M01)**](./compiler-ir-and-abi-boundary.md) — six-layer contract, IR, server/client backends, narrow ABI, build metadata, wire, five worked examples
- [M02 Semantic IR feasibility report](./m02-semantic-ir-feasibility.md) — spike result: five examples expressible; OPEN items
- [M03-A lexical scope resolution](./m03-scope-resolution.md) — **DESIGN**: BindingId vs classification, full scope semantics, captures/dependencies, host classifier contract
- [M03-B expression identity](./m03-expression-identity.md) — **DESIGN**: lowering route with source-verified TypeScript APIs, registry/IR separation, source maps, identity limits
- [M03-I-0 source-map prototype decision](./m03-i0-sourcemap-prototype.md) — M1 marker-based **anchors** adopted; M3 closed on API grounds; end-to-end map still OPEN (M05)
- [M03 review corrections register](./m03-review-corrections.md) — which review findings were resolved, and which questions stay OPEN
- [M05 leaf-codegen prototype (NOT G1)](./m05-g1-leaf-prototype.md) — **PROTOTYPE**: compiler-private DOM mount/update/dispose recipe, supported shapes, host-values contract, compile-time sink denial and 2026-11-06 audit evidence; G1/M05/S1 not claimed
- [M01 consumer migration matrix](./m01-consumer-migration-matrix.md) — 23 consumers with target layer, replacement, stage and retirement condition
- [**Compiler-native architecture (canonical)**](./compiler-native-architecture.md) — P1–P5, responsibility split, Part Program's transitional role, canonical vocabulary
- [Alpha16–18 current reality and contradictions](./alpha16-18-current-reality.md) — status matrix, contradiction matrix, boundary answers, asset preservation
- [Alpha16–18 cleanup and migration inventory](./alpha16-18-cleanup-inventory.md) — KEEP/REFACTOR/REPLACE/RETIRE rows with consumers and exit criteria
- [Alpha16–18 freeze audit](./alpha16-18-freeze-audit.md) — contradiction register (FR-01…FR-16; FR-13…FR-16 opened by the 2026-11-05 consistency revision), source coverage ledger, chain map, freeze statement
- [Alpha16–18 retirement roadmap](./alpha16-18-retirement-roadmap.md) — disposition matrix and phased deletion gates
- [Alpha16–18 fourth-pass reassessment](./alpha16-18-fourth-pass-reassessment.md) — **APPROVED 2026-11-03 (P-1…P-5)**: retire the Class authoring API and the serialized Part Program protocol; narrow ABI
- [Alpha16–18 architecture audit](./alpha16-18-architecture-audit.md) — what alpha.15 actually implements, what is reusable, what must change
- [TSX author candidate contract](./tsx-author-candidate-contract.md) — 30 review cases; approved TSX-03/04/05/09/10 semantics; unreleased APIs, not implementation evidence
- [JSX values and repeatable children](./jsx-value-and-children-model.md) — mount recipes, evaluation timing, owner/region model, rejected alternatives
- [Alpha16–18 execution plan](./alpha16-18-execution-plan.md) — M01–M14, 16a/16b/17/18 stage split, G1/G2/G3, work classes, §8a/§8b and the risk register; the dependency spine (no dates) is the authoritative stage definition
- [Alpha16–18 progress ledger and audit closure register](./alpha16-18-progress.md) — tracked M01–M14 status with evidence PR/SHA, gate records and the Alpha16a exit gap list, plus the 2026-11-03 audit closure register; a merged slice updates its row in the same PR
- [Alpha16–18 semantic test matrix](./alpha16-18-semantic-test-matrix.md) — per-case evidence ledger; all rows not run
- [Compiler and element runtime](./compiler-and-element-runtime.md)
- [Rendering and hydration](./rendering-and-hydration.md)
- [Router and server runtime](./router-and-server-runtime.md)
- [Packages and distribution](./packages-and-distribution.md)
- [Seams registry](./seams.md)
- [Shim inventory (P5 registry)](./shim-inventory.md) — the compatibility layers each seam's guard protects, with owner, retirement condition and disposition (machine-read by `shims:check`)
- [Security and release engineering](./security-and-release-engineering.md)

Decision records live in the [ADR index](../adr/README.md). Every record is
listed there exactly once, with a status annotation for a record that no longer
governs (`SUPERSEDED` / `RETIRED` / `EXECUTED`) or that carries an amendment
(`AMENDED`); `@openelement/tools-repo#adr-index:check` enforces that policy.
Older retired records remain recoverable from Git history.
