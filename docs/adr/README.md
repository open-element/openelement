# Architecture decisions

The [architecture index](../architecture/README.md) links the current technical
contracts. The ADR index lists each maintained decision once and
`@openelement/tools-repo#adr-index:check` verifies the links and record status.

`AMENDED` identifies a decision with a later amendment. A retained record that
declares itself superseded, retired or executed must carry the matching index
annotation.

- [ADR-0110-two-product-doctrine-and-package-truth.md](./ADR-0110-two-product-doctrine-and-package-truth.md)
- [ADR-0111-router-package-ownership-boundary.md](./ADR-0111-router-package-ownership-boundary.md)
- [ADR-0120-0-42-0-wc-application-loop-scope.md](./ADR-0120-0-42-0-wc-application-loop-scope.md)
- [ADR-0125-hydration-instance-purity.md](./ADR-0125-hydration-instance-purity.md)
- [ADR-0128-decouple-page-registration-from-tagname-export.md](./ADR-0128-decouple-page-registration-from-tagname-export.md)
- [ADR-0129-response-header-channel.md](./ADR-0129-response-header-channel.md)
- [ADR-0137-public-package-ownership-boundaries.md](./ADR-0137-public-package-ownership-boundaries.md)
- [ADR-0142-light-mode-in-place-activation.md](./ADR-0142-light-mode-in-place-activation.md)
- [ADR-0143-0-44-compiled-element-model-reentry.md](./ADR-0143-0-44-compiled-element-model-reentry.md) — AMENDED: accepted next architecture; implementation pending (2026-10-31)
- [ADR-0148-compiler-semantic-core-vite-integration-boundary.md](./ADR-0148-compiler-semantic-core-vite-integration-boundary.md) — AMENDED: accepted next architecture; implementation pending (2026-10-31)
- [ADR-0152-product-router-and-alpha-convergence.md](./ADR-0152-product-router-and-alpha-convergence.md) — AMENDED: first-party Lit renderer retired with zero compatibility window (owner ruling 2026-11-08); the published alpha.15 artifact still contains the retired lane
- [ADR-0153-beta2-2-document-seam-and-submission-tuple.md](./ADR-0153-beta2-2-document-seam-and-submission-tuple.md)
- [ADR-0154-alpha-baseline-removals.md](./ADR-0154-alpha-baseline-removals.md)
- [ADR-0155-client-only-entry-subpath.md](./ADR-0155-client-only-entry-subpath.md) — AMENDED: retirement condition 2 discharged under the amendment's operative reading (owner-ratified; literal satisfaction not claimed) — `./client-only` retired with the generic claim executor in Alpha17 (ADR-0184, 2026-11-28); condition 1 remains unmet
- [ADR-0157-web-component-admission-tiers.md](./ADR-0157-web-component-admission-tiers.md)
- [ADR-0158-streaming-server-executor.md](./ADR-0158-streaming-server-executor.md) — AMENDED: accepted next architecture; implementation pending (2026-10-31)
- [ADR-0159-part-backfill-and-late-claim.md](./ADR-0159-part-backfill-and-late-claim.md)
- [ADR-0160-architecture-debt-repayment.md](./ADR-0160-architecture-debt-repayment.md)
- [ADR-0161-node-pnpm-consumer-surface.md](./ADR-0161-node-pnpm-consumer-surface.md)
- [ADR-0163-seam-single-ownership.md](./ADR-0163-seam-single-ownership.md)
- [ADR-0164-island-style-asset-protocol.md](./ADR-0164-island-style-asset-protocol.md)
- [ADR-0166-regions-axis-entry-subpaths.md](./ADR-0166-regions-axis-entry-subpaths.md) — AMENDED: `./no-regions` retired in alpha15 (blocks axis: `./no-blocks` / `./base`); the blocks-axis entries retired in Alpha17 under a recorded owner-ratified replacement of retirement condition 2, not literal satisfaction of it (ADR-0184, 2026-11-28)
- [ADR-0167-declared-tailwind-compilation.md](./ADR-0167-declared-tailwind-compilation.md)
- [ADR-0168-style-provider-port.md](./ADR-0168-style-provider-port.md)
- [ADR-0169-request-time-rendering-surface.md](./ADR-0169-request-time-rendering-surface.md) — AMENDED: bounded full-await server-function seam (2026-11-09; M14 definition 2026-11-17; 2026-11-18 wording reconciliation — the change is bounded, M14 is not claimed met)
- [ADR-0170-late-host-island-activation.md](./ADR-0170-late-host-island-activation.md)
- [ADR-0171-private-artifact-static-boundary.md](./ADR-0171-private-artifact-static-boundary.md) — AMENDED: accepted next architecture; implementation pending (2026-10-31)
- [ADR-0172-document-lang-resolution.md](./ADR-0172-document-lang-resolution.md)
- [ADR-0173-component-execution-and-composition.md](./ADR-0173-component-execution-and-composition.md) — AMENDED: author semantics, slice prerequisites, reusable JSX values; class authoring retirement approved (fourth pass); implementation pending (2026-11-03)
- [ADR-0174-generated-code-runtime-and-compatibility.md](./ADR-0174-generated-code-runtime-and-compatibility.md) — AMENDED: slice order, Alpha16a/16b split with the release gate intact, and approved retirement of the serialized Part Program protocol; implementation pending (2026-11-03)
- [ADR-0175-alpha16a-m07-decisions-and-current-view.md](./ADR-0175-alpha16a-m07-decisions-and-current-view.md)
- [ADR-0176-alpha16-plan-amendments-registry.md](./ADR-0176-alpha16-plan-amendments-registry.md)
- [ADR-0177-internal-artifact-resolution-subpaths.md](./ADR-0177-internal-artifact-resolution-subpaths.md) — AMENDED: the third `/internal/*` subpath `./internal/compiled/leaf-runtime` is named (2026-11-20), and the one written retirement condition now reads across the two surviving internal subpaths with this record as the single owner (`./internal/compiled/runtime` retired with its target module, ADR-0184, 2026-11-28)
- [ADR-0178-release-line-qualification-anchor.md](./ADR-0178-release-line-qualification-anchor.md)
- [ADR-0179-unix-philosophy-absorption.md](./ADR-0179-unix-philosophy-absorption.md)
- [ADR-0180-function-component-lifecycle-intrinsics.md](./ADR-0180-function-component-lifecycle-intrinsics.md)
- [ADR-0181-generated-element-ssr-and-retention.md](./ADR-0181-generated-element-ssr-and-retention.md)
- [ADR-0182-function-component-capability-api.md](./ADR-0182-function-component-capability-api.md) — AMENDED: 2026-11-20 remediation amendments — approved carrier (execution-plan §18), the two public subpaths, the open-button/open-input migration records, the JSON seed identity/wire, the dropdown Correction 3 correction, `useHost` FUTURE/OWED, the `provideContext` accepted ambiguity, the `16b-EB` delivery truth and the client-JS SLO ratification
- [ADR-0183-one-reactive-contract.md](./ADR-0183-one-reactive-contract.md)
- [ADR-0184-alpha17-emitted-runtime-entry-retirement.md](./ADR-0184-alpha17-emitted-runtime-entry-retirement.md)

## Decisions in Git history

The retired records remain available at their archived revisions. [ADR-0108](https://github.com/open-element/openelement/blob/e655a0bab6f1396f4ed1a10208794e51e592b0ce/docs/legacy/adr/ADR-0108-deno-native-npm-distribution.md) · [ADR-0112](https://github.com/open-element/openelement/blob/e655a0bab6f1396f4ed1a10208794e51e592b0ce/docs/legacy/adr/ADR-0112-protocol-types-and-tiny-runtime.md) · [ADR-0156](https://github.com/open-element/openelement/blob/e655a0bab6f1396f4ed1a10208794e51e592b0ce/docs/legacy/adr/ADR-0156-tree-sha-evidence-reuse.md) · [ADR-0162](https://github.com/open-element/openelement/blob/e655a0bab6f1396f4ed1a10208794e51e592b0ce/docs/legacy/adr/ADR-0162-element-runtime-compiler-split-deferred.md).
