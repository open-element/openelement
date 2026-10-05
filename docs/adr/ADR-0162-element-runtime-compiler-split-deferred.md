# ADR-0162: Element runtime/compiler package split — deferred to alpha10

- Status: PROPOSED (verdict recorded for owner adjudication; this ADR does
  not move any code)
- Measured at: commit `230fcd669` (alpha9 C4), 2026-10-05, working tree
  clean except this ADR's own lane
- Origin: issue #1508 scope item 3 ("runtime-vs-compiler package split
  evaluation — verdict with evidence: execute here or defer to alpha10")

## Context

#1508 opened with the premise "1,022KB unpacked ships the compiler to
runtime consumers" and asked for a measured verdict: execute the
runtime-vs-compiler package split on the alpha9 C5 lane, or defer it to
alpha10 with a SHA-backed rationale. The premise number pre-dates the
alpha9 C1-C3 token-swap and alias-layer deletions, so the first step was
re-measurement.

## Measurement (all commands run at `230fcd669`)

**Tarball** — `npm pack --dry-run` in `packages/element`:

```
package size: 183.3 kB
unpacked size: 654.1 kB
total files: 97
```

The #1508 premise (1,022 KB unpacked) is stale by ~36%; even the earlier
lane reference (179 KB gz / 844 KiB unpacked, pre-C1) has shrunk to
183.3 KB gz / 654.1 KB unpacked — the C1-C3 deletions (Open Props layer,
alias sheet) removed ~190 KB of shipped source.

**Layer census** (summed file bytes under `packages/element/src`):

| layer | files | bytes |
| --- | --- | --- |
| `src/internal/compiler/**` (semantic-core + plugin) | 12 | 155 KB |
| `src/internal/compiled/**` (runtime, serializer, server) | 24 | 224 KB |
| `src/internal/protocol/**` | 15 | 106 KB |
| `src/internal/core/**` | 16 | 55 KB |
| `src/*.ts` top level | 22 | 83 KB |

**Per-export static import closures** (trace of relative `from '...'` and
dynamic `import('...')` specifiers from each `exports` target):

| entry | files | KB | compiler files |
| --- | --- | --- | --- |
| `"."` | 68 | 457 | **0** |
| `"./client-only"` | 68 | 458 | 0 |
| `"./authoring"` | 12 | 62 | 0 |
| `"./html"` | 10 | 63 | 0 |
| `"./logger"` | 2 | 3 | 0 |
| `"./build-utils"` | 12 | 45 | 0 |
| `"./jsx-runtime"` | 5 | 37 | 0 |
| `"./compiler"` | 17 | 227 | 12 |
| `"./vite"` | 17 | 225 | 12 |

The compiler entry adds exactly **13 files / 156 KB** over the `"."` entry
(`src/compiler.ts` + the whole `src/internal/compiler/` tree).

**Dependency weight** — `rg "from 'typescript'" packages/element/src`
matches only `src/internal/compiler/**` (10 files); no runtime entry file
imports it. Yet `packages/element/package.json` declares
`"dependencies": { "typescript": "6.0.3" }` (a hard, non-optional
runtime dependency), and `typescript@6.0.3` installs to
**~24.1 MB** (`du -sk` of the pnpm store entry, block-rounded).

## Analysis

1. **The #1508 framing is resolved by half.** A runtime consumer importing
   `@openelement/element` never LOADS the compiler: the `"."` closure
   contains zero compiler files. The only cost of co-packaging today is
   install footprint — 156 KB of unused source bytes in `node_modules`.
2. **The 156 KB is not the real weight — the dependency is.** Every
   consumer, including pure-runtime ones, installs `typescript@6.0.3`
   (~24.1 MB) because the manifest declares it for the compiler entry's
   benefit. Moving `typescript` to an optional peer
   (`peerDependenciesMeta: { typescript: { optional: true } }`, keeping it
   in `devDependencies` for the workspace) would cut ~24 MB from every
   runtime-only install — roughly 150× the byte win of the package split —
   at manifest-only cost. It changes install behavior for downstream, so
   it needs its own packed-consumer qualification round (the packed
   qualification exercises `./compiler` and must then declare the peer);
   it is deliberately NOT a C5 ride-along on the bump train.
3. **A package split is a release-surface-wide change.** A fifth package
   touches: `docs/release/release-state.json` (schema v3 `packages[]`,
   per-package dist-tags, `latestPrerelease` partition) and the admission
   constant `ADMITTED_ACTIVE_TARGET`; `RETAINED_PACKAGE_NAMES` /
   `PACKAGE_COUNT` (derived from release-state); the roster and
   dependency-direction rules in `tools/release/check-package-graph.ts`
   (`ALLOWED_DEPENDENCY_DIRECTION`); publish order in `npm-publisher.ts`;
   the six `consumer-packaged-*.ts` qualification harnesses; the
   `@openelement/create` starter templates and their pins; the version
   bump stamp surface (now ten points, would grow); the README/zh source
   -tree claims ("all four packages"); and the www copy. That
   reconciliation surface is measured in release-train risk, not bytes.
4. **The evidence-reuse contract prices the timing.** Any structural
   repackaging invalidates tree-SHA evidence reuse and re-runs the full
   consumer matrix; doing it on the same train as the first
   publish-through-the-new-bump-task (alpha9) stacks two unproven surfaces
   into one candidate.

## Verdict (for owner adjudication)

**Defer the package split to alpha10** (or drop it if lever 2 lands):

1. The measured install-footprint stake is 156 KB of source (654.1 KB →
   ~498 KB unpacked for runtime consumers), down from the stale 1,022 KB
   premise — not enough to justify a fifth package on the alpha9 train.
2. The remedy that matters is the `typescript` dependency reclassification
   (~24.1 MB per runtime install), which is a manifest change with a
   qualification plan, not a package boundary change. Recommend scheduling
   it early in alpha10 with a packed-consumer round dedicated to it.
3. If alpha10 still wants the split after lever 2, the entry-closure table
   above is the acceptance baseline: a `@openelement/element` runtime
   package should pack ≈498 KB unpacked with the `"."` closure unchanged
   (68 files / 457 KB), and `@openelement/element-compiler` (or a moved
   `./compiler` + `./vite` pair) carries the 156 KB + the `typescript`
   dependency.

Final ruling rests with the owner; no structural change was made in this
lane.
