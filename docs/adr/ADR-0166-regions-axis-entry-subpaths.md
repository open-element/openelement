# ADR-0166: The regions axis of runtime-shape specialization — the `no-regions` and `base` entry subpaths

- Status: ACCEPTED (2026-10-07, alpha.11 train — the minimal #1548 lane);
  **AMENDED** (2026-10-18 — `./no-regions` was retired in the alpha.15 line and
  the axis is now the blocks axis, `./no-blocks` / `./base`; see
  [Amended status](#amended-status-2026-10-18)); **AMENDED** (2026-11-28 — the
  blocks-axis entries retired in Alpha17 under a recorded owner-ratified
  replacement of retirement condition 2, not literal satisfaction of it; see
  [ADR-0184](./ADR-0184-alpha17-emitted-runtime-entry-retirement.md) and the
  amendment at the end)
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

## Amended status (2026-10-18)

**The `./no-regions` entry no longer exists; the axis is now the blocks axis.**
Alpha15's batch 4 (`277a732b6`, 2026-10-11) demolished the Regions mirror and
removed the subpath — its own breaking-change list says "`./no-regions` subpath
removed (use `./no-blocks`)". What replaced it:

- The emitted client entry selects between `./base`, `./client-only`,
  `./no-blocks`, and the full entry through the three
  `ssg/element-services-{full,client-only,base}.ts` re-export shims
  (`entry-client-codegen.ts`): the claim axis (#1416) and the blocks axis
  (#1548) choose among them.
- `./no-blocks` drops the `when`/`each` Block builders; `./base` drops both
  axes. Wire-level values (`owner.kind: 'region'`, block ids `rN`) are frozen
  and unchanged — the rename is at the runtime-shape/entry layer only.
- The public-interface snapshot and the packed tarball contain no
  `no-regions` entry; `@openelement/element` exports `client-only`, `no-blocks`,
  and `base`. (Update 2026-11-28: this sentence is historical as of the Alpha17
  retirement — the package no longer publishes any of the three; see the
  amendment at the end and
  [ADR-0184](./ADR-0184-alpha17-emitted-runtime-entry-retirement.md).)

The P5 retirement condition above still applies to the surviving entries: they
are deletable as one unit when bundlers select per-graph entry bodies natively
or the grammar retires dynamic Blocks/Regions. The decision record below is
kept for the rationale (P2/P5 trade, seam shape, fail-closed guards); a future
axis must start from a new decision record rather than reviving this subpath.

## See also

- [ADR-0155](./ADR-0155-client-only-entry-subpath.md) — the claim axis this
  extends; the entry-split and seam patterns reused here.
- [seams.md](../architecture/seams.md) — the "Region-builders runtime
  specialization" row (P8 registration).

## Amendment (2026-11-28): the blocks-axis entries retire — retirement condition 2 recorded as an owner-ratified replacement

Append-only amendment. Owner-directed 2026-11-28 in session as part of the
three-PR Alpha17 delivery; the written carrier for the public-surface half is
[ADR-0184](./ADR-0184-alpha17-emitted-runtime-entry-retirement.md). The
2026-10-18 amended status above stays as written (it retired `./no-regions` and
named the surviving entries); this section retires those surviving entries.

What changed: `packages/element/package.json` no longer publishes `./no-blocks`
or `./base`. The Block-builder runtime (`runtime/blocks.ts`,
`runtime/blocks-seam.ts`, `runtime/blocks-install.ts`), the client build's
blocks scan/alias and the side-effect install edge that kept the builders alive
are deleted with the generic executor; compiler-generated condition and list
factories own mount and claim, and the `seams.md` row for this seam records the
withdrawal.

Which condition decided it: **retirement condition 2** — "the Part Program
grammar retires dynamic Regions ... no graph needs the builders and the default
entry becomes what `./no-regions` is today" — recorded as an **owner-ratified
replacement**, not as formal satisfaction of the written condition. Its operative
reading is: no graph needs the builders because the builders no longer exist and
every emitted component carries its own condition/list code. Condition 1
(bundler-native per-graph entry bodies) is **not** met; it is not used.

What is explicitly not claimed (the literal gap): the condition's antecedent —
that `when`/`each` lowering is "replaced by static or platform-native
constructs" — does not hold verbatim. Emitted generated-leaf code still performs
marker-based conditions and keyed list reconciliation at runtime (`oe:each` /
`oe:k:` wire), so no static-lowering or platform-native claim is made; what
retired is the generic Block-builder set and its install edge, not dynamism or
the wire vocabulary. The removal is authorized by the repository owner's
2026-11-28 direction and by the operative reading above — a recorded
owner-ratified replacement, and a later reader must not cite this amendment as
proof that the written antecedent was met. The removed entries re-exported the
shared public surface (`public-surface.ts`), not an axis-specific API, so
removing them removes that alternate spelling of the surface; any symbol the
package dropped from every entry is the separate `.`/wire delta listed in
ADR-0184, not this axis. The earlier amended status's rule that a future axis
must start from a new decision record also governs `./no-blocks` and `./base`:
the deleted names are not revived by pointing this record at them.

This record stays **ACTIVE** as the rationale for the runtime-shape axis
(P2/P5 trade, seam shape, fail-closed guards); the later record that carries the
removal is ADR-0184.
