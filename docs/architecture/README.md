# Architecture

OpenElement has two public products: Element and Router. The remaining packages
adapt, scaffold, build, and distribute those products.

- [Design principles](./design-principles.md) ([中文](./design-principles.zh.md))
- [Product model and 2026-11-03 direction](./product-model.md)
- [**Compiler IR and ABI boundary (M01)**](./compiler-ir-and-abi-boundary.md) — six-layer contract, IR, server/client backends, narrow ABI, build metadata, wire, five worked examples
- [M01 consumer migration matrix](./m01-consumer-migration-matrix.md) — 23 consumers with target layer, replacement, stage and retirement condition
- [**Compiler-native architecture (canonical)**](./compiler-native-architecture.md) — P1–P5, responsibility split, Part Program's transitional role, canonical vocabulary
- [Alpha16–18 current reality and contradictions](./alpha16-18-current-reality.md) — status matrix, contradiction matrix, boundary answers, asset preservation
- [Alpha16–18 cleanup and migration inventory](./alpha16-18-cleanup-inventory.md) — KEEP/REFACTOR/REPLACE/RETIRE rows with consumers and exit criteria
- [Alpha16–18 freeze audit](./alpha16-18-freeze-audit.md) — contradiction register (FR-01…FR-12), source coverage ledger, chain map, freeze statement
- [Alpha16–18 retirement roadmap](./alpha16-18-retirement-roadmap.md) — disposition matrix and phased deletion gates
- [Alpha16–18 fourth-pass reassessment](./alpha16-18-fourth-pass-reassessment.md) — **APPROVED 2026-11-03 (P-1…P-5)**: retire the Class authoring API and the serialized Part Program protocol; narrow ABI
- [Alpha16–18 architecture audit](./alpha16-18-architecture-audit.md) — what alpha.15 actually implements, what is reusable, what must change
- [TSX author candidate contract](./tsx-author-candidate-contract.md) — 30 review cases; approved TSX-03/04/05/09/10 semantics; unreleased APIs, not implementation evidence
- [JSX values and repeatable children](./jsx-value-and-children-model.md) — mount recipes, evaluation timing, owner/region model, rejected alternatives
- [Alpha16–18 execution plan](./alpha16-18-execution-plan.md) — slices, G1/G2/G3, work classes and risk register
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
