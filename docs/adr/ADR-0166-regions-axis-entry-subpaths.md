# ADR-0166: The regions axis of runtime-shape specialization — the `no-regions` and `base` entry subpaths

- Status: ACCEPTED (2026-10-07, alpha.11 train — the minimal #1548 lane)
- Amends: extends [ADR-0155](./ADR-0155-client-only-entry-subpath.md) from one
  runtime axis (the claim executor) to two (the when/each Region builders);
  same P2/P5 regime, same seam shape.
- Tracking: [#1548](https://github.com/open-element/openelement/issues/1548)
  (umbrella: compile-time selection of runtime modules).

## Context

#1548's direction: the compiler knows what a program uses — emit only the
runtime modules it needs. The minimal lane is the regions axis: an app whose
compiled Part Programs carry no `when`/`each` Parts can never execute the
Region machinery, yet every bundle carrying the compiled kernel did.

Two facts made this a public-surface question, exactly the two that made
ADR-0155 one:

1. The mechanism is entry selection, and the entries are **public exports of
   a published package** (interface snapshot, packed tarball, npm manifest).
2. It moves another **who decides** boundary into Router's client build: the
   framework now chooses between four runtime shapes, not two.

A third fact is new to this axis and worth recording because it inverts the
obvious implementation: **the generated client entry's specifier alone cannot
prune the regions cluster.** Every compiled island module imports
`@openelement/element` for its base class, and the package's `sideEffects`
declaration (#1425) keeps the default entry's installs alive in every graph
that touches the specifier — measured on the `router-request-time` fixture:
entry-only specialization changed the shared `element-runtime` chunk by one
byte. The emission half must therefore live in the client build's resolution.

## Decision

1. **The Region builders reach the runtime through a seam, not a static
   import.** `internal/compiled/runtime/regions-seam.ts` holds
   `installRegionBuilders` / `regionBuildersOrFail`
   (`OE_RUNTIME_REGION_BUILDERS_MISSING` on absence);
   `runtime/regions-install.ts` is the one module that names both the seam and
   `regions.ts`, whose builders (`buildWhen`, `buildEach`, `updateWhen`,
   `updateEach`, `whenActive`, `expectsArrayMessage`) stay the single
   definition and single owner. The former static edges
   (`fresh-dom.ts`, `claim.ts`, `claim-recovery.ts`, `runtime.ts`'s seed
   serializer) route through the seam, so a graph without the install drops
   the whole regions module.

2. **Four entries cover the two independent axes.** The claim axis
   (#1416) and the regions axis compose; each entry is
   `public-surface.ts` plus a subset of the two installs:

   | entry | claim | regions |
   | --- | --- | --- |
   | `.` (default) | ✓ | ✓ |
   | `./client-only` | — | ✓ (a client-only island still builds fresh Regions from client state) |
   | `./no-regions` | ✓ | — |
   | `./base` | — | — |

   All four re-export the identical surface (`public-surface.ts` — no second
   list to edit) and the interface snapshot pins all four to one
   `publicShapeSha256`.

3. **A missing builder set fails closed, naming the entries that install.**
   A `when`/`each` Part reaching a regions-free graph is a build-selection
   bug, never a silent mis-render — the ADR-0155 posture on the second axis.

4. **The client build decides, on the compiler's own fact, in two halves.**

   - **Detection** (`router/vite/internal/ssg/island-regions-scan.ts`
     `islandsMightUseRegions`): walks the admitted islands' import closure
     (relative by path, bare through Node resolution) and compiles every
     reachable module through the same public `compileElementModule` the Vite
     plugin runs; `program.regions` non-empty anywhere means regions. Every
     inconclusive answer — an island specifier that resolves nowhere, a module
     the compiler rejects, a walk past its visit budget — resolves to "might
     use regions". The asymmetry is deliberate and shared with ADR-0155:
     guessing "full" costs bytes; guessing "regions-free" breaks every
     when/each Part at runtime.
   - **Emission**: the generated entry imports the four-way specifier, AND —
     this is the half the entry specifier cannot do — the client build adds an
     anchor-anchored exact alias `@openelement/element` → the resolved
     entry's `no-regions` sibling, so the islands' own imports take the same
     shape (source `.ts` in the workspace, compiled `.js` in a packed
     install). The alias backs off to the default resolution on any surprise:
     the app aliases the element specifier itself, the package cannot be
     resolved, or the sibling is missing. Dev does not alias: the dev module
     graph is shared with SSR, which must keep rendering Regions.

5. **The sideEffects contract moves with the installs** (#1425 class): the
   flagged set is the three importing entries plus both installers, mirrored
   source-side (package.json) and packed-side
   (`tools/release/npm-manifest.ts`), guarded by the shared walker
   (`packages/element/__tests__/side-effects-declaration.test.ts`,
   `pack-surface`).

## Verification

Measured in this lane's session on `tests/fixtures/router-request-time`
(no Region Parts in any island; every island hydrates SSR, so the claim
cluster must stay):

| build | `element-runtime` chunk | gzip -9 |
| --- | --- | --- |
| default resolution (full entry) | 82,152 B | 25,717 B |
| regions-free resolution | 76,301 B | 23,930 B |

−5,851 B (−7.1%) raw, −1,787 B (−7.0%) gz, with the claim executor and kernel
strings still present and the regions cluster gone. The per-feature floor
table's `base` / `+regions` rows (#1548 acceptance) start here: the regions
axis composes with the claim axis rather than replacing it.

## Consequences

- **Two public subpaths exist where one did** (`./no-regions`, `./base`),
  both removable as one unit with their seam (retirement condition below).
- **A new fail-closed runtime error exists**:
  `OE_RUNTIME_REGION_BUILDERS_MISSING` — reachable only by a selection bug or
  a hand-written bundle importing a regions-free entry for a Regions-using
  app; the message names the entries that install.
- **The client build now rewrites one specifier** (exact, anchor-anchored,
  backs off conservatively). This is build-time surface bought for runtime
  reduction — the P2 trade this ADR exists to record.
- **Dev stays full**: dev neither specializes the entry graph nor aliases;
  specialization is observable in built output, where the size lanes measure.
- **The vitest environment cannot model an unresolvable element specifier**
  (the module runner anchors bare-specifier resolution at the workspace), so
  the alias's resolution-failure branch is pinned through an injected
  resolver, not an fs fixture — recorded here because it is the kind of
  test-environment divergence that otherwise looks like a gap.

## Retirement condition

Per P5, the regions axis is deletable as one unit — the two subpaths,
`regions-seam.ts`, `regions-install.ts`, the runtime call sites' seam lookups,
the scan, the client-build alias, and the snapshot/sideEffects entries — when
either of these holds:

1. **Bundlers select per-graph entry bodies natively** (the ADR-0155
   condition 1, unchanged): if the module graph can be told which conditional
   entry body to resolve per bundle, the four entries and the alias reduce to
   one entry plus a bundler feature.
2. **The Part Program grammar retires dynamic Regions** (the stronger
   condition): if `when`/`each` lowering is replaced by static or
   platform-native constructs, no graph needs the builders and the default
   entry becomes what `./no-regions` is today.

## See also

- [ADR-0155](./ADR-0155-client-only-entry-subpath.md) — the claim axis this
  extends; the entry-split and seam patterns reused here.
- [seams.md](../architecture/seams.md) — the "Region-builders runtime
  specialization" row (P8 registration).
