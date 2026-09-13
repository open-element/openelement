# ADR-0148: Compiler semantic core and Vite integration boundary

- Status: ACCEPTED
- Amends: ADR-0143

## Decision

The private compiler has two one-way layers:

```text
Vite hooks, graph, HMR, chunks, manifests
                    |
                    v
       Vite integration shell
                    |
                    v
 bundler-neutral compiler semantic core
                    |
                    v
 Part Program, diagnostics, source mappings
```

The semantic core owns OpenElement class/decorator/TSX meaning, deterministic Part and Region
identity, lowering, diagnostics, and source-span data. Its inputs are explicit. It must not import
Vite/Rollup types, HMR/dev-server state, routing, SSG, Hono, deployment code, ambient time, network,
or mutable global build state.

The Vite shell owns scheduling, module identity, resolution, caches, HMR, virtual modules, chunking,
manifest aggregation, source-map composition, and presentation of diagnostics. It may optimize when
the semantic core runs but may not redefine language or Part Program semantics.

Compiler and Element runtime meet only through a deterministic, serializable, versioned artifact.
Generated browser/runtime/declaration graphs contain no compiler implementation or Vite plugin.
The core remains private; another bundler or a public compiler package requires a separate decision.

## Verification

- Direct semantic-core fixtures run without Vite.
- A forbidden-import check enforces the dependency direction.
- Canonical inputs produce byte-stable programs, metadata, diagnostic codes, and locations.
- Vite integration tests cover transforms, source maps, HMR, splitting, and manifests.
- Cross-package fixtures pass server serialization, browser creation, and DOM claim.
