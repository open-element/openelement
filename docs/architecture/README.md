# Architecture

OpenElement has two public products: Element and Router. The remaining packages
adapt, scaffold, build, and distribute those products.

- [Design principles](./design-principles.md) ([中文](./design-principles.zh.md))
- [Product model and 2026-11-03 direction](./product-model.md)
- [TSX author candidate contract](./tsx-author-candidate-contract.md) — 22 review cases; unreleased APIs, not implementation evidence
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
