# ADR-0137: Public package ownership boundaries

- Status: ACCEPTED (reconciled for `1.0.0-alpha.1`)
- Depends on: ADR-0110, ADR-0111

## Decision

1. Public package entries expose deliberate facade modules and never name an `internal/` module.
2. Element exports only component authoring/runtime contracts. It does not own routing, content,
   application, Vite, or deployment types.
3. App exports Router Route Mode and Framework Mode contracts. Pure Route Mode does not import
   Element or renderer packages.
4. Adapter-vite owns compiler/build integration and related public configuration types. It may not
   mirror another package root with `export type *`.
5. Create owns onboarding templates and their version selection, not runtime behavior.
6. Private implementation movement does not change public exports. Every intentional public-surface
   change updates the checked interface snapshot.

## Verification

The package-surface, dependency-graph, declaration-graph, package-artifact, and public-interface
snapshot gates enforce these boundaries. Isolated packed consumers prove that package metadata does
not install optional products or hide workspace-only imports.
