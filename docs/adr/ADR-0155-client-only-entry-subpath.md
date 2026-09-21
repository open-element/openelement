# ADR-0155: The `client-only` entry subpath and the claim executor seam

- Status: ACCEPTED (2026-09-22, alpha3 consolidation — records the #1416 E2
  surgery)
- Amends: none. Extends the P2/P5 regime of
  `docs/architecture/design-principles.md` (P2 litmus: runtime surface needs an
  ADR; P5: every shim lands with a written retirement condition).
- Tracking: [#1416](https://github.com/open-element/openelement/issues/1416),
  [#1423](https://github.com/open-element/openelement/pull/1423),
  [#1424](https://github.com/open-element/openelement/pull/1424),
  [#1425](https://github.com/open-element/openelement/issues/1425).

## Context

P2 says "runtime surface added to user applications is presumed rejected", and
its litmus is explicit: _does this add build-time surface or runtime surface?
Runtime surface needs an ADR._ The #1416 E2 surgery added a **public subpath**
to `@openelement/element`:

```text
@openelement/element/client-only  ->  packages/element/src/client-only.ts
```

Before the surgery, one entry (`.`) reached the compiled claim executor by
static import, so every bundle that linked the compiled kernel carried the
whole claim cluster — the structure walker, the validation, the recovery
builders, the diagnostics. For a page where **no island can hydrate server
DOM**, that code could never execute: nothing in such a page's DOM was
server-rendered, so no connected element can find pre-existing content to
claim. The cost was paid by every page regardless of whether it could ever
use it.

The measurement that motivated the change is recorded in PR #1423: on the JFB
keyed-table harness, the full graph bundled to **77,639 B** and the same page
from the new entry to **68,630 B** (**−8,927 B, −11.5%**), with the claim
diagnostic strings (`compiled-claim`, `attribute drift on`, `unexpected
trailing nodes`) absent from the reduced bundle. Re-measured in this ADR's
session at `de8c9c265` (see Verification): **78,702 B** full entry vs
**69,295 B** client-only entry, **−9,407 B (−11.95%)** — the scale holds on a
later base, the absolute bytes differ because other lanes landed between the
two points.

Two facts made the split a public-surface question rather than a private
optimization, and both are why this needs an ADR rather than a changelog line:

1. The new subpath is a **public export of a published package**, so it
   participates in the public interface snapshot, the packed tarball, the npm
   manifest, and the facade documentation the same way `.` does.
2. It changes **who decides** what a page's bundle contains. That decision now
   lives in Router's generated client entry, not in a hand-written import — so
   the framework, not the author, is choosing between two runtime surfaces.

## Decision

1. **The `client-only` entry is the complete public surface minus the claim
   executor — nothing else.** The export list is spelled out exactly once, in
   `packages/element/src/public-surface.ts`, and both entries re-export it:

   - `packages/element/src/index.ts` imports
     `./internal/compiled/runtime/claim-install.ts` (whose evaluation installs
     the executor), then re-exports the shared surface;
   - `packages/element/src/client-only.ts` re-exports the shared surface and
     nothing else.

   The subpath is not a subset, a subset-with-extras, or a "lite" surface: it
   is the same names with one capability missing, so a page can move between
   the two entries without an authoring change. `public-surface.ts` is the
   drift guard — the two entries cannot diverge by construction, because there
   is no second list to edit.

2. **The executor reaches the kernel through a seam, not a static import.**
   The kernel must not import the claim implementation, or every graph that
   links the kernel keeps it. `internal/compiled/runtime/claim-seam.ts` holds a
   module-level binding (`installClaimExecutor` / `claimExecutor`);
   `claim-install.ts` is the one module that names both the seam and
   `claimExistingDom`, and is imported for its side effect by the default entry
   only. `claimExistingDom` in `runtime.ts` stays the single definition and
   single owner of claiming.

   Installation is an ordinary module side effect, not a global: the entry
   module evaluates before any element can connect, so the executor is present
   by the time the kernel needs it, and no host global is written.

3. **A missing executor fails closed, naming the entry that can hydrate.**
   `kernel.ts` throws when it is asked to claim content and no executor is
   installed, with a message that names both the subpath it was reached
   through and the entry to import instead. Omitting the claim is therefore
   never a silent mis-render: an element connected through the subpath whose
   resolved root already has content (server-rendered tree, or light-DOM
   children standing in for the template) is an authoring error, reported as
   one.

4. **Router selects the entry per page, conservatively, on one predicate.**
   The generated client entry imports `@openelement/element` unless the page
   **cannot** hydrate server DOM, in which case it imports the subpath.
   `pageCanHydrateServerDom` returns true if _any_ island this page can upgrade
   may hydrate server markup:

   ```ts
   island.strategy !== 'only' && (island.ssr !== false || island.dsd !== false);
   ```

   The asymmetry is deliberate: silence is not a client-only claim (an island
   that declares neither flag is treated as able to hydrate), and
   `strategy === 'only'` is the one shape that proves client-only on its own,
   because `resolveIslandSsrDsd` forces both flags off for `hydrate: 'only'`.
   **Any doubt resolves to the full entry.** The two failure directions are not
   symmetric: guessing "full" costs ~9 KB on a page that did not need it;
   guessing "client-only" on a page that hydrates server markup breaks
   hydration. The cost of being wrong in the cheap direction is paid; the cost
   of being wrong in the expensive direction is designed out.

   Application authors normally never name either entry — the generated entry
   states the decision. The subpath is public so the decision is inspectable
   and so a hand-written bundle (the JFB harness is one: it states the alias
   directly in its sandbox config) can make the same choice deliberately.

5. **Both entries are pinned to one `publicShapeSha256`.** The public interface
   snapshot records `.` and `./client-only` as the same 73 symbols under the
   same shape hash
   (`658f4f62be873e3526301ece3b326fed570d7fcfd54a64ef9901928f0ccabfd2`), so a
   change that reaches one entry and not the other fails
   `tools/repo#interface:snapshot` rather than shipping. The package test suite
   pins the same invariant at runtime (`claim-entry-split.test.ts`, "both
   entries export exactly the same names") and keeps a floor rather than an
   exact count, so _adding_ a name stays a deliberate, snapshot-owned act while
   _dropping_ one from the subpath is always a failure.

6. **The subpath ships as a first-class entry, not a convenience alias.** It is
   in `packages/element/deno.json` `exports`, in the generated
   `OPENELEMENT_EXPORT_FILES` map, in the packed tarball's `package.json`
   `exports`, and in the public interface snapshot. It carries the same
   type surface as `.` (the packed tarball ships `src/client-only.d.ts`).

## Consequences

- **Two entries exist where one did.** This is P2 surface, accepted only
  because it is _removable_ surface (see the retirement condition) and because
  it removes more runtime than it adds on the pages that select it. The
  subpath adds one module of indirection (the seam) to the full graph.
- **A new failure mode is possible and is fail-closed**: reaching the subpath
  on a page that does hydrate server markup throws instead of half-rendering.
  Pinned by `packages/element/__tests__/claim-entry-split.test.ts` (fresh
  connect through the subpath; fail-closed on unclaimable content; the default
  entry claiming that same content; identical export names) and by the
  reverse-direction codegen case in
  `packages/router/__tests__/entry-generators.test.ts` (a page with any `dsd`
  island never takes the subpath).
- **Selection is a Router-owned build-time decision**, so it is only as
  trustworthy as the island metadata the build reads. The predicate is
  deliberately conservative for exactly that reason.
- **The surface scanners had to move with the export list.** Three existing
  source scanners (`isr-removal.test.ts`, `signal-boundary.test.ts`) read
  `src/index.ts` as text; with the list relocated they would have silently
  stopped covering the surface. They now scan `public-surface.ts` and both
  entries. This is recorded here because it is the recurring hazard of this
  shape: a scanner pinned to one file is silently defeated by moving that
  file's content into a shared seam.
- **Open risk, tracked, not silently accepted.** Issue #1425 is open: the
  packed-starter browser matrix (consumer-harness leg 6) fails 3/3 browsers
  with a `waitForFunction` timeout while the identical probe against a
  manually-scaffolded packed starter passes all three. The new subpath is
  named among the suspects (tmp-dir starter lock resolution vs a real npm
  install). The current mitigation is the tracked
  `OPEN_ELEMENT_SKIP_BROWSER_MATRIX=1` guard, which the issue says to delete
  when the matrix is green. Until that issue closes, the packaged path for
  this subpath is **qualified by construction and by unit tests, not by a
  green end-to-end matrix** — that gap is part of this ADR's state of record,
  not a footnote to it.

## Retirement condition

Per P5 (_"every shim lands with a written retirement condition"_), this
subpath and its seam are deletable, and the condition is specific. **The
subpath, `claim-seam.ts`, `claim-install.ts`, the kernel's seam lookup, the
`pageCanHydrateServerDom` predicate, and the `deno.json`/snapshot/packed
entries can all be deleted as one unit when either of these holds:**

1. **Bundlers support per-page conditional exports natively.** If the module
   graph can be told, per page, which conditional branch of one entry to
   resolve — so that the claim cluster is dropped by the bundler's own
   per-page resolution rather than by a second entry — then the second entry
   adds nothing the platform-tool layer does not already do, and the seam is
   framework code reimplementing a bundler capability (P1: what the platform
   provides to fill a gap is debt with a retirement condition attached).
   _How many lines of application code change: zero._ The generated entry
   returns to importing one specifier.

2. **The Part Program reaches full static lowering (no claim need).** If every
   page's program can be resolved to its final DOM statically, so that no
   connected element ever has pre-existing content it must adopt, then no
   graph needs the claim executor at all and the full entry becomes what the
   subpath is today. The seam's reason to exist disappears with the
   capability it guards. This is the stronger condition: it retires the claim
   machinery itself, not just the entry split.

Neither condition is met today. When either is met, the deletion is one unit —
no compatibility layer, no deprecated alias period (Alpha permits breaking
cleanup; see ADR-0154 and the P5 clause on compatibility living only at
deployment boundaries). If the condition is met and the deletion is deferred,
that deferral is itself an ADR-level decision, not a maintenance default.

The jfb harness's hand-written alias is not part of the retirement surface: it
is a sandbox config, and reverting one alias line is the whole cost there.

## Verification

Run in the session that produced this ADR, in the worktree at
`.work/alpha3/adr` (branch `alpha3/adr-client-only`, based on `origin/dev`
`de8c9c265`):

| Command                                                                                        | Result                                                                                           |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `deno task check`                                                                              | 0 — `gate ok: 4 step(s)`                                                                         |
| `deno run --allow-all benchmarks/jfb/harness/build.ts --local-only --build-dir /tmp/oeadr-jfb` | 0 — `bundleBytes: 69295` (client-only entry)                                                     |
| same, with the harness alias pointed at `src/index.ts` (probe reverted afterwards)             | 0 — `bundleBytes: 78702` (full entry), delta **−9,407 B**                                        |
| `deno task --cwd tools/repo interface:snapshot`                                                | 0 — `Public interface snapshot matches (4 packages).` (`.` and `./client-only` both `658f4f62…`) |
| `deno task --cwd tools/repo export-files:check`                                                | 0 — sync check passed                                                                            |
| `deno task --cwd tools/repo release:state-machine:check`                                       | 0 — source `1.0.0-alpha.2`                                                                       |
| `deno task --cwd tools/release pack:dry-run`                                                   | 0 — 4 tarballs; element packed manifest carries `./client-only`                                  |
| `deno task --cwd tools/release package-artifacts:check`                                        | 0 — `Package artifact checks passed for 4 packages.`                                             |
| `deno task --cwd tools/release pack-surface:check`                                             | 0 — `Packed facade check passed`                                                                 |

Recorded-figure note: `packages/element/src/client-only.ts` cites
"77,639 B full graph → 68,203 B from this entry" while PR #1423's table records
68,630 B for the same reduced build. The two in-tree figures differ by 427 B;
the PR measurement and the re-measurement above are the ones this ADR relies
on. The comment is left as-is rather than silently rewritten — it is a source
file outside this ADR's change, and the discrepancy is recorded here so it is
not lost.
