# REL-05 — A6 (review FR-08) adjudication on the fixed toolchain

Candidate: `ef5da43e45d887b214841a99c26d3f8d2dac358b` (branch `alpha15`).
Toolchain: node `v24.18.0` (`.node-version`), pnpm `12.8.1` (`packageManager`),
Playwright browsers installed 2026-10-08. Recorded 2026-10-19 20:08 +08:00.

The review's FR-08 is an *unexplained* local build/qualification difference, so it
must be adjudicated with artifacts, not prose. This document separates the three
claims that were previously conflated:

1. the review's claim — a clean rebuild from an emptied `www/dist` still leaves
   `www/dist/server/entry.js`, and `www/tools/site-package-sheet-admission.test.ts`
   fails 5 passed / 1 failed at line 346 (`open-input.css` referenced by
   `server/entry.js`);
2. this machine's existing build output — no `www/dist/server` at any depth, and
   the same test file passes 6/6;
3. the code path that produces and removes `dist/server` for a pure-static
   project — a single `rm` whose failure was swallowed, followed by an
   unconditional success log (fixed in this worktree; §3.2).

## 1. Review claim (as written)

- Environment as reported: node 24.19.0, pnpm 11.25.0 — neither exists on this
  machine; the repository's fixed toolchain is node 24.18.0 / pnpm 12.8.1.
- `www/tools/site-package-sheet-admission.test.ts:346` — the contract-sheet loop
  (`expect(referencing(emitted)).toEqual([])`) failed for the emitted
  `open-input` sheet, with `server/entry.js` named as the referencing artifact.
- Reported to survive "isolating the old `www/dist`" and "building and testing
  in the same command".
- Not reproducible in this workspace; the claim is recorded here, not re-run,
  because its toolchain does not exist locally.

## 2. Existing build output on the fixed toolchain

`www/dist` here is the output of the Lead's `pnpm run site:build` at
2026-10-19 17:45 +08:00, on this SHA and toolchain. The A6 test consumes build
output and nothing else, so it is the correct object to assert against until the
Lead's consolidation build replaces it.

Command and evidence (`/tmp/release-evidence/rel05/dist-inventory.txt`):

```sh
find www/dist -maxdepth 3 -name 'server' -print   # (no output)
find www/dist -type f | wc -l                     # 308
ls -la www/dist/client/assets                     # 10 .css + font assets, all content-hashed
```

No `server` directory exists at any depth under `www/dist`; there is no
`server/entry.js` to be referenced.

Single-file test (`pnpm exec vitest run --project www
www/tools/site-package-sheet-admission.test.ts`, wall 1.74 s, log
`/tmp/release-evidence/rel05/a6-single-file-on-existing-dist.log`):

```text
 ✓ |www| www/tools/site-package-sheet-admission.test.ts (6 tests) 138ms
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

The test's own built-output assertion was replayed as a standalone probe
(`/tmp/release-evidence/rel05/a6-built-output-probe.mjs`,
`a6-built-output-probe.json`) against the same tree. It reproduces the test's
derivation exactly (marker → emitted sheet → referencing artifacts) and prints
the per-sheet facts the assertion compresses:

| contract sheet | emitted asset | bytes | referencing artifacts |
| --- | --- | --- | --- |
| `open-input.css` | `587479b5da6d.css` | 573 | (none) |
| `open-dialog.css` | `e21c276907b3.css` | 1389 | (none) |
| `open-dropdown.css` | `873192923dbc.css` | 150 | (none) |
| `overlay-recipe.css` | `0e8ca0e38604.css` | 393 | (none) |

Positive control: the three sheets www does render are referenced
(`open-button` 9 artifacts, `open-code-block` 5, `open-theme-toggle` 75), and
the orphan scan returns none — so the "unreferenced" set is exactly the four
contract sheets, not an empty-tree artifact.

The empty-directory rebuild itself was not run in this lane: Lane E is editing
`www/content/docs` and `pnpm run site:build` begins with `generate:all`, which
rewrites the generated site data and `www/dist` under it (Lead ruling, this
session). The Lead's consolidation build will produce the clean-empty-directory
run on the frozen tree.

## 3. Code path: how a pure-static build ends up with `dist/server`

`packages/router/src/cli/build-ssg.ts`:

- the SSR bundle is built into `dist/server` (`ssrOutDir = join(root, outDir, 'server')`,
  line 367) and imported from `dist/server/entry.js` (line 545); its CSS asset
  addresses are compiled into that bundle;
- `ssgRender()` writes `dist/server/index.js` **only** when the project has a
  `renderIntent 'dynamic'` route or any page with an action
  (`packages/router/src/vite/internal/ssg/ssg-render.ts:285-310`);
- for a pure-static project the directory is then removed (lines 590-599):

```ts
if (!existsSync(join(ssrOutDir, 'index.js'))) {
  await rm(ssrOutDir, { recursive: true, force: true }).catch(() => {});
  log.info('Pure-static build: removed build-time SSR bundle (dist/server)');
}
```

Three properties of those four lines matter to FR-08:

1. the removal decision is taken **after** the whole render pass, so `entry.js`
   exists for the entire build and is only removed at the very end;
2. a failed `rm` is **swallowed** (`.catch(() => {})`) — permissions, a busy
   directory, or a concurrent writer can leave `dist/server` in place;
3. the success line is printed **whether or not** the removal happened, so the
   log the review quoted ("removed build-time SSR bundle") cannot distinguish
   success from a swallowed failure.

www is pure-static at this SHA: `www/app/routes` declares no
`renderIntent 'dynamic'` route and no action, so `index.js` is never written
and the removal branch is always taken.

### 3.1 Mechanism demonstration (scratch, no repository change)

`/tmp/release-evidence/rel05/rm-swallow-demo.mjs` is the same four lines with a
read-only parent directory, so `rm` fails with `EACCES`:

```text
--- run (parent read-only, rm must fail) ---
INFO Pure-static build: removed build-time SSR bundle (dist/server)
after: dist/server exists = true
after: dist/server/entry.js exists = true
```

This reproduces the review's *symptom shape* — a build that logs removal and
still leaves `dist/server/entry.js` — from the code alone. It does not prove
that this is what happened on the reviewer's machine.

### 3.2 The removal path is fixed in this worktree

The Lead extended this lane's write scope to `packages/router/src/cli/build-ssg.ts`
and `packages/router/__tests__/build-ssg-bundle-url.test.ts`; the fix is applied
in the working tree (commit-less, branch `alpha15`, base `ef5da43`):

- the four lines above are replaced by `finalizePureStaticOutput(ssrOutDir)`,
  an exported helper that (i) returns without touching anything when
  `dist/server/index.js` exists (the request-time contract), (ii) treats an
  absent directory as nothing-to-remove, (iii) verifies the directory is gone
  after the `rm`, (iv) logs the removal **only** on that verified state, and
  (v) throws `SsrRenderError` carrying the underlying error when the directory
  survives;
- **choice: hard fail, not a loud warning.** `dist/server` is server code and
  the deployment contract says it must never ship to static hosting
  (`www/content/docs/guide/deployment.md`); a surviving bundle is exactly the
  state the boundary exists to prevent, and a warning leaves it deployable.
  Residual risk: an environmental `rm` failure (locked file, permission) now
  fails an otherwise successful build. That is accepted deliberately — the
  failure text names `dist/server` and carries the OS error, so the remedy is
  visible — and the helper's re-check means a removal that raised but still
  cleared the directory does not fail;
- observable contract pinned in `build-ssg-bundle-url.test.ts` (5 new cases,
  all passing): a stale `dist/server/entry.js` is removed and logged once; a
  request-time `index.js` is kept and never logged as removed; an absent
  directory logs nothing; a removal that leaves the directory behind fails with
  `could not be removed` and logs nothing; a removal that raised after clearing
  the directory is not a failure;
- end-to-end check on the real static-only fixture: a pre-injected stale
  `tests/fixtures/router-static-only/dist/server/entry.js` build ran to exit 0,
  logged `[build-ssg] Pure-static build: removed build-time SSR bundle
  (dist/server)`, and the directory is gone
  (`/tmp/release-evidence/rel05/static-only-stale-build.log`).

The empty-directory rebuild of `www` itself still runs at Lead consolidation on
the frozen tree (Lane E is editing `www/content/docs`, and `site:build` begins
with `generate:all`).

## 4. Adjudication

- **The A6 admission contract is not the defect.** On the fixed toolchain's
  build output, the four sheets are emitted and unreferenced by design, the three
  rendered sheets are referenced, the orphan set is empty, and all six tests in
  the file pass. The assertion logic has no path that produces the review's
  failure from a clean pure-static build.
- **The review's observation is environment/build-state-specific, not a
  repository-state reproduction.** Its toolchain (node 24.19.0 / pnpm 11.25.0)
  does not exist here, and neither the empty-directory claim nor the failure can
  be reproduced on the fixed toolchain. Ranked mechanisms consistent with both
  the review's symptom and this code: (a) the swallowed `rm` failure left a
  stale `entry.js` in place; (b) a concurrent build (the review ran the full
  suite around the same tree and reported repeated build/test attempts) re-created
  `dist/server` after the removal; (c) an unexpected `dist/server/index.js`
  made the branch hybrid. The evidence cannot separate (a) from (b)/(c); the
  review's own report does not either.
- **There was a real, small build-hygiene defect, and it is now fixed.**
  build-ssg.ts claimed removal unconditionally and discarded the failure. Under
  the FR-01 security boundary (server code must never ship to static hosting,
  `www/content/docs/guide/deployment.md`), a silent leftover is the wrong
  failure mode. It is a defect in the *removal path*, not in the A6 assertion,
  and it is fixed in this worktree (§3.2, §5).
- **Recommended ledger disposition**: A6 is not a product regression in the
  admission/emission contract; close it as environment-specific with the
  build-hygiene fix tracked separately. The proposed ledger row is in section 6.

## 5. Landed minimal patch (this lane)

`packages/router/src/cli/build-ssg.ts`: the finalize step is an exported helper
(`finalizePureStaticOutput`, placed beside `ssrBundleImportUrl`) with an
optional io seam so the failure path is testable without filesystem tricks. The
implementation, as landed:

```ts
export async function finalizePureStaticOutput(
  ssrOutDir: string,
  io: {
    exists?: (path: string) => boolean;
    remove?: (path: string) => Promise<void>;
    info?: (message: string) => void;
  } = {},
): Promise<boolean> {
  const exists = io.exists ?? existsSync;
  const remove = io.remove ?? ((path: string) => rm(path, { recursive: true, force: true }));
  const info = io.info ?? ((message: string) => log.info(message));
  if (exists(join(ssrOutDir, 'index.js'))) return false;
  if (!exists(ssrOutDir)) return false;
  let removalError: unknown = null;
  try {
    await remove(ssrOutDir);
  } catch (error) {
    removalError = error;
  }
  if (exists(ssrOutDir)) {
    const cause =
      removalError instanceof Error
        ? removalError
        : new Error(
            removalError === null
              ? 'the directory still exists after fs.rm(recursive, force)'
              : String(removalError),
          );
    throw new SsrRenderError(
      'pure-static build: the build-time SSR bundle (dist/server) could not be removed; ' +
        'server code must never ship to static hosting',
      cause,
    );
  }
  info('Pure-static build: removed build-time SSR bundle (dist/server)');
  return true;
}
```

Call site: `await finalizePureStaticOutput(ssrOutDir);` replaces the four
swallowed lines in `buildSSG()`.

The tests landed in `packages/router/__tests__/build-ssg-bundle-url.test.ts`
(7 tests in the file, 5 new; wall 1.07 s):

- `build-ssg: a stale dist/server is removed by a pure-static finalize` —
  real filesystem: a `dist/server/entry.js` is gone afterwards and the removal
  message was logged exactly once;
- `build-ssg: a request-time entry keeps dist/server and is never logged as removed`
  — `index.js` present: nothing removed, no message;
- `build-ssg: an absent dist/server is nothing-to-remove, never a removal claim`;
- `build-ssg: a removal that leaves the directory behind fails the build` — the
  rejection matches `could not be removed` and nothing is logged;
- `build-ssg: a removal error that still cleared the directory is not a failure`
  — the re-check makes the verdict about the directory, not about the exception.

Deliberately not part of the patch: widening the A6 assertion, retrying the
removal, or treating "the four sheets are unreferenced" as a failure. The
admission contract is correct; only the removal's error handling was not.

## 6. Proposed known-reds ledger row (Lead-owned file)

`internal working ledger (not published)` — proposed row text, not applied here:

> **FR-08 / A6 (alpha15)** — *environment-specific observation; removal path
> fixed in this batch*. On node 24.18.0 / pnpm 12.8.1 the A6 file passes 6/6
> against the site build (`www/dist` has no `server/` at any depth; probe: 4
> contract sheets emitted and unreferenced, 3 rendered sheets referenced). The
> reviewer's node 24.19.0 / pnpm 11.25.0 observation is not reproducible here.
> Root cause candidates (cannot be separated from the review's report): the
> previously swallowed `rm` in `build-ssg.ts` leaving a stale
> `dist/server/entry.js`, a concurrent build re-creating it, or a pre-existing
> `dist/server/index.js`. Fix landed in this batch:
> `finalizePureStaticOutput()` removes and verifies, logs only a verified
> removal, and fails the build otherwise; contract pinned by 5 tests in
> `packages/router/__tests__/build-ssg-bundle-url.test.ts`. The `www` empty-dir
> rebuild runs at Lead consolidation (see
> `docs/release/evidence/alpha15/rel05-a6-adjudication.md` §3.2/§5). No assertion
> in `site-package-sheet-admission.test.ts` is to be weakened.

## 7. Evidence index

| path | content |
| --- | --- |
| `/tmp/release-evidence/rel05/dist-inventory.txt` | SHA/toolchain, `find` sweep, `www/dist` listing and file count |
| `/tmp/release-evidence/rel05/a6-single-file-on-existing-dist.log` | the 6/6 vitest run (wall 1.74 s) |
| `/tmp/release-evidence/rel05/a6-built-output-probe.json` | per-sheet emitted/referenced evidence |
| `/tmp/release-evidence/rel05/rm-swallow-demo.mjs` | the four-line removal reproduction |
| `/tmp/release-evidence/rel05/a6-built-output-probe.mjs` | probe source (replicates the test's derivation) |
| `/tmp/release-evidence/rel05/static-only-stale-build.log` | real fixture build with a pre-injected stale `dist/server/entry.js`: exit 0, verified removal log, directory gone |
| `packages/router/__tests__/build-ssg-bundle-url.test.ts` | 7 tests (5 new) pinning the finalize contract; 1.07 s wall |
