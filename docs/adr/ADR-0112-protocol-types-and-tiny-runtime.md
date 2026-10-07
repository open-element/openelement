# ADR-0112: Protocol Types and Tiny Runtime

- Status: SUPERSEDED by [ADR-0152](./ADR-0152-product-router-and-alpha-convergence.md)
- Date: 2026-07-10
- Superseded: the `@openelement/protocol` contracts package this decision
  governs no longer exists — it left the tree at v0.40.0 (`605d85bb6`),
  and [ADR-0152](./ADR-0152-product-router-and-alpha-convergence.md)
  superseded the multi-package boundary it belonged to; the shared
  contract types now live inside `@openelement/element`
  (`packages/element/src/public-surface.ts`), which the retired-API gate
  (`tools/repo/check-retired-api-refs.ts`) bars from re-emerging as a
  package.

## Context

`@openelement/protocol` was described as type-only, but its public interface
already includes small runtime values such as `ErrorCode`, `ERROR_PREFIX`, and
hydration-marker validation. These values are shared vocabulary, have no host
dependencies, and moving them into core would couple consumers to an
implementation package.

## Decision

Protocol is a contracts package with a tiny standards-only runtime. Runtime
exports must be deterministic, side-effect free, and use no DOM, Deno, Node,
network, filesystem, timer, or process APIs. Stateful implementations and
product behavior remain outside protocol.

## Consequences

- Documentation matches the shipped package.
- Shared constants and pure guards remain at the contract seam.
- Protocol is no longer described as type-only or runtime-free.
- Runtime additions require architecture review to keep the surface tiny.
