# Decision records

Every architecture decision record lives in this directory. The index below is
its registry: `tools/repo/check-adr-index.ts`
(`@openelement/tools-repo#adr-index:check`) reads it in `gate:source`, so the
policy is enforced rather than stated.

1. **Every record is listed exactly once.** A `docs/adr/ADR-NNNN-*.md` file that
   no index entry links, and a link that resolves to no file, are both
   violations.
2. **A record that no longer governs is retained, and its entry says so.**
   Superseded, retired and executed decisions stay in this directory as decision
   history — later records and the code they shaped cite them — and their index
   entry carries one annotation from the closed vocabulary `SUPERSEDED` /
   `RETIRED` / `EXECUTED`, followed by the reason or the successor. `AMENDED` is
   the optional fourth annotation for a record whose status carries an
   amendment; an amended record stays active.
3. **An entry's annotation must agree with the record.** The checker reads the
   record's own `Status:` line: a record that declares itself superseded,
   retired or executed but is indexed as active — or the reverse — is a
   violation.
4. **Retired evidence is named as retired.** When a citation's target was
   removed, the citing text says so in place (with the change that removed it)
   instead of leaving a dangling path. Rules 1–3 are machine-checked; this rule
   is a review obligation.

Evidence cited by an active ADR follows the same policy: ADR-0120's commissioned
six-framework application-loop research
(`docs/audit/2026-07-27-application-loop-framework-research/`, removed
2026-10-18) was retired into Git history in `3b5c7a9a` and remains recoverable
there (`git show 3b5c7a9a^:docs/audit/2026-07-27-application-loop-framework-research/README.md`).

- [ADR-0108-deno-native-npm-distribution.md](./ADR-0108-deno-native-npm-distribution.md) — SUPERSEDED by ADR-0161
- [ADR-0110-two-product-doctrine-and-package-truth.md](./ADR-0110-two-product-doctrine-and-package-truth.md)
- [ADR-0111-router-package-ownership-boundary.md](./ADR-0111-router-package-ownership-boundary.md)
- [ADR-0112-protocol-types-and-tiny-runtime.md](./ADR-0112-protocol-types-and-tiny-runtime.md) — SUPERSEDED by ADR-0152
- [ADR-0120-0-42-0-wc-application-loop-scope.md](./ADR-0120-0-42-0-wc-application-loop-scope.md)
- [ADR-0125-hydration-instance-purity.md](./ADR-0125-hydration-instance-purity.md)
- [ADR-0128-decouple-page-registration-from-tagname-export.md](./ADR-0128-decouple-page-registration-from-tagname-export.md)
- [ADR-0129-response-header-channel.md](./ADR-0129-response-header-channel.md)
- [ADR-0137-public-package-ownership-boundaries.md](./ADR-0137-public-package-ownership-boundaries.md)
- [ADR-0142-light-mode-in-place-activation.md](./ADR-0142-light-mode-in-place-activation.md)
- [ADR-0143-0-44-compiled-element-model-reentry.md](./ADR-0143-0-44-compiled-element-model-reentry.md) — AMENDED: accepted next architecture; implementation pending (2026-10-31)
- [ADR-0148-compiler-semantic-core-vite-integration-boundary.md](./ADR-0148-compiler-semantic-core-vite-integration-boundary.md) — AMENDED: accepted next architecture; implementation pending (2026-10-31)
- [ADR-0152-product-router-and-alpha-convergence.md](./ADR-0152-product-router-and-alpha-convergence.md)
- [ADR-0153-beta2-2-document-seam-and-submission-tuple.md](./ADR-0153-beta2-2-document-seam-and-submission-tuple.md)
- [ADR-0154-alpha-baseline-removals.md](./ADR-0154-alpha-baseline-removals.md)
- [ADR-0155-client-only-entry-subpath.md](./ADR-0155-client-only-entry-subpath.md)
- [ADR-0156-tree-sha-evidence-reuse.md](./ADR-0156-tree-sha-evidence-reuse.md) — RETIRED by the #1567 CI/Release redesign (mechanism removed 2026-10-18; record retained)
- [ADR-0157-web-component-admission-tiers.md](./ADR-0157-web-component-admission-tiers.md)
- [ADR-0158-streaming-server-executor.md](./ADR-0158-streaming-server-executor.md) — AMENDED: accepted next architecture; implementation pending (2026-10-31)
- [ADR-0159-part-backfill-and-late-claim.md](./ADR-0159-part-backfill-and-late-claim.md)
- [ADR-0160-architecture-debt-repayment.md](./ADR-0160-architecture-debt-repayment.md)
- [ADR-0161-node-pnpm-consumer-surface.md](./ADR-0161-node-pnpm-consumer-surface.md)
- [ADR-0162-element-runtime-compiler-split-deferred.md](./ADR-0162-element-runtime-compiler-split-deferred.md) — EXECUTED: the deferred split landed (2026-10-11 addendum in the record)
- [ADR-0163-seam-single-ownership.md](./ADR-0163-seam-single-ownership.md)
- [ADR-0164-island-style-asset-protocol.md](./ADR-0164-island-style-asset-protocol.md)
- [ADR-0166-regions-axis-entry-subpaths.md](./ADR-0166-regions-axis-entry-subpaths.md) — AMENDED: `./no-regions` retired in alpha15 (blocks axis: `./no-blocks` / `./base`)
- [ADR-0167-declared-tailwind-compilation.md](./ADR-0167-declared-tailwind-compilation.md)
- [ADR-0168-style-provider-port.md](./ADR-0168-style-provider-port.md)
- [ADR-0169-request-time-rendering-surface.md](./ADR-0169-request-time-rendering-surface.md)
- [ADR-0170-late-host-island-activation.md](./ADR-0170-late-host-island-activation.md)
- [ADR-0171-private-artifact-static-boundary.md](./ADR-0171-private-artifact-static-boundary.md) — AMENDED: accepted next architecture; implementation pending (2026-10-31)
- [ADR-0172-document-lang-resolution.md](./ADR-0172-document-lang-resolution.md)
- [ADR-0173-component-execution-and-composition.md](./ADR-0173-component-execution-and-composition.md)
- [ADR-0174-generated-code-runtime-and-compatibility.md](./ADR-0174-generated-code-runtime-and-compatibility.md)
