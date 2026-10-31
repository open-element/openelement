# TPL-03 — fresh-scaffold starter quality gate

Lane D (templates-ci), task-4. Branch `alpha15`, base HEAD `ef5da43` plus this
lane's edits, 2026-10-19. Scratch logs under `<scratch>/templates-ci/`.

TPL-03 asks for one thing: a CI gate that runs **create → typecheck → lint → test
→ build → smoke** on a freshly scaffolded starter, so a template regression is a
red build instead of a user's first run. This document records the ruling that
decided where the gate lives, what actually runs, and the evidence that it fails
closed.

## 1. Ruling: a named step inside the existing `pack` job, not a new CI job

Lead ruling (2026-10-19), recorded here as TPL-03 asks: add the chain as
clearly-named step(s) in the existing base-layer `pack` job; do **not** add a
new job ID.

Why a step:

- **The `pack` job already pays for the exact artifact the chain proves.** Its
  existing "Starter smoke" step runs `setup.ts`: `pack:dry-run` the release
  tarballs, scaffold through the packed `@openelement/create` CLI, rewire the
  `@openelement/*` pins to those tarballs, `pnpm install` the starter's own
  dependency surface, then build it for the Playwright smoke. The quality gate
  runs on that SAME scaffold — a second job would re-pay the packed install
  (minutes) to prove the same tree.
- **The job is already in the base layer**, so the gate runs on every push and
  every PR, not only on a main-push/full-qualification dispatch.
- **Zero qualification-contract churn.** The contract's evidence is the
  individual conclusions of the workflow's job IDs and their matrix instances
  (release workflow `ci-evidence` required list, `CONTRIBUTING`, the internal
  release procedure (not published), the known-reds ledger claim cross-checked by
  `check-doc-claims`). A new job ID
  would force those out-of-lane files to change together; extending `pack`
  leaves every job ID and instance count as it was and only adds a step to a job
  that was already required.
- **Fail closed by construction.** The step runs a Node script whose every
  lifecycle leg is `runStep` (nonzero exit throws) and whose smoke leg asserts
  HTTP status + marker over the wire.

The step is named for the contract a reader needs:
`Starter quality gate (create -> typecheck -> lint -> test -> build -> smoke)`.

## 2. What runs (exact chain)

`.github/workflows/autoflow-ci.yml`, job `pack`:

1. (existing, unchanged) `Starter smoke (needs packed workspace)` →
   `@openelement/e2e-starter-smoke gate` = harness typecheck + `setup.ts`
   (create + install + build) + the three-browser Playwright smoke.
2. (new) `Starter quality gate (create -> typecheck -> lint -> test -> build ->
   smoke)` → `@openelement/e2e-starter-smoke quality` =
   `tests/e2e/starter-smoke/quality.ts` against the scaffold step 1 created.

`quality.ts` legs, in order (each logged, each fail-closed):

| leg | command | what it proves |
| --- | --- | --- |
| create | scaffold presence/scripts assertion | the tree is the packed CLI's output (step 1), and it carries the full lifecycle scripts |
| typecheck | `pnpm run typecheck` (`tsc --noEmit`) | TPL-01's generated tsconfig: `types: ["@openelement/element/css-modules", "node"]` + the `@types/node` pin + the DOM-typed interval handle |
| lint | `pnpm run lint` (`oxlint`, shipped pin) | the template lints clean with the toolchain it ships |
| test | `pnpm run test` (`node --test`; zero test files is a pass by design) | the shipped test script runs |
| build | `pnpm run build` (`oe build`) | the real SSG + client + server build of a freshly generated project |
| smoke | `pnpm run start` (`oe start`) on a reserved port, then HTTP probes | `/` carries "Rendered before JavaScript arrives", `/about` carries "Static first, interactive where it counts", `/api/ping` returns `"pong":true`; server stopped by process group in a `finally` |

The scaffold lives OUTSIDE the repository, in a per-run `mkdtemp` directory
(`tests/e2e/starter-smoke/paths.ts`; `STARTER_SMOKE_WORK_DIR` overrides the
root verbatim). `setup.ts` records the chosen root in
`tests/e2e/starter-smoke/node_modules/.starter-smoke-work-dir` (gitignored; the
harness already requires an install), and `quality.ts`, both Playwright configs
and `dev.spec.ts` resolve it through that one helper and fail closed with one
actionable line when neither the pointer nor the override exists. The location
is load-bearing — §5 records the CI failure it fixes, §7 the CodeQL follow-up
that made the root unpredictable.

## 3. RED before the change (why the gate is needed)

- **Starter typecheck RED (timer half, reproduced).** The pre-TPL-01 starter
  typed the interval field as a `number` while calling the bare global
  `setInterval`, which resolves to Node's overload once `@types/node` is in the
  program. The packed-tarball scaffold with that timer fails:
  `app/islands/live-timer.tsx(40,5): error TS2322: Type 'Timeout' is not
  assignable to type 'number'.` (`<scratch>/templates-ci/tpl01-timer-red.log`,
  exit 2). The fix (window.setInterval + number) is what the gate's typecheck
  leg now proves green.
- **Starter typecheck RED (missing types half, from the review).** The pre-fix
  template shipped no `@types/node` and a `types` allowlist without `node`
  (the review's `TS2591`). This lane could not isolate that failure in its
  symlink-mirrored local check — installed `.d.ts` files reference node types
  transitively, so the type package enters the program even when the app's own
  `types` entry is removed — so the durable proof here is the fixed surface
  (generated tsconfig names both entries; the manifest pins `@types/node`), and
  the CI typecheck leg is the regression alarm.
- Neither failure had a CI path: the packed-starter job ran Playwright against
  the built app but never the starter's own typecheck/lint/test scripts.
- **Browser boundary RED (build fail-open).** On HEAD an island with
  `import 'node:fs';` built green with only "Module node:fs has been
  externalized for browser compatibility": a plain Vite browser build of the
  same island exits 0 and emits its chunk with the `__vite-browser-external`
  stub inlined (`<scratch>/templates-ci/vite-fail-open.log`). After the TPL-01 guard
  the same fixture exits 1 with
  `[OE_CLIENT_BUILD_BROWSER_ENTRY_NODE_BUILTIN]`, while the loader-page and
  clean fixtures still exit 0 (`<scratch>/templates-ci/probe-after-guard.log`).

## 4. Local evidence (real `pnpm`, no shim)

After the §5 fix, the REAL CI invocation was run on this tree:

```sh
pnpm --dir tests/e2e/starter-smoke run setup        # pack + scaffold (outside repo) + install + build
vp run --no-cache --fail-if-no-match --filter @openelement/e2e-starter-smoke quality
```

| evidence | command | result |
| --- | --- | --- |
| the template's own lint script, user-like context | `cd <pointer root>/my-blog && pnpm run lint` (root read from the pointer file) | `Found 0 warnings and 0 errors. Finished … on 13 files with 96 rules`, exit 0 |
| the exact CI invocation | `vp run --no-cache --fail-if-no-match --filter @openelement/e2e-starter-smoke quality` | every leg green incl. smoke on `/`, `/about`, `/api/ping`; final line "the fresh-scaffold lifecycle is green"; exit 0 (`<scratch>/templates-ci/quality-final.log`) |
| fail closed (lint leg, lint-only error) | seed `.oxlintrc.json` `{"rules":{"no-debugger":"error"}}` + `app/components/lint-seed.ts` with `debugger;`, then the same gate invocation | `pnpm run typecheck` exit 0 (the failure really is lint-only); `pnpm run lint` exit 1 ("Found 0 warnings and 1 error"); the gate exits 1 at the lint leg (`<scratch>/templates-ci/quality-seeded.log`). Seeds removed, gate green again (exit 0) |
| Playwright configs resolve the moved scaffold | `playwright test --config tests/e2e/starter-smoke/playwright.config.ts --list` (31 tests) and `…playwright.dev.config.ts --list` (4 tests) | exit 0 for both |
| real browser smoke from the external scaffold | `playwright test --config tests/e2e/starter-smoke/playwright.config.ts --project=chromium` | 10 passed (9.1s) (`<scratch>/templates-ci/pw-chromium.log`) |
| pack/quality precondition | `pnpm --dir tests/e2e/starter-smoke run setup` | `starter-smoke ready at <scratch>/openelement-starter-smoke-<random>/my-blog`, exit 0; the pointer file records that root |
| workflow YAML | `python3 -c "import yaml; ..."` on `.github/workflows/autoflow-ci.yml` | parses; 10 job IDs unchanged; `pack` carries the new named step |
| workflow linters | `actionlint` (exit 0); `zizmor --offline .github` 1.30.0 | no findings |

Targeted suites (this lane): `vitest run --project create` (the create suite,
including the packed-CLI test), `vitest run --project router
packages/router/__tests__/browser-entry-boundary.test.ts`. Package typechecks:
`tsc --noEmit -p packages/create/tsconfig.json`,
`-p packages/router/tsconfig.json`, `-p tests/e2e/starter-smoke/tsconfig.json` —
all green; `oxfmt --check` / `oxlint` green on the touched files.

Targeted suites re-run on this tree: `vitest run --project create` (create
suite incl. the packed-CLI test) and `vitest run --project router
packages/router/__tests__/browser-entry-boundary.test.ts`; package typechecks
for create/router/starter-smoke; `oxfmt --check`, `oxlint` and markdownlint on
the touched files — all green (logs under `<scratch>/templates-ci/`). The `pack`
job's timeout (40 min, measured) has headroom for the ~1 minute of lifecycle
commands the step adds.

## 5. First CI run (39262312202): the lint leg failed — root cause and fix

The first real CI run of the step failed exactly at the lint leg:

```text
$ pnpm run lint   # cwd=…/tests/e2e/starter-smoke/work/my-blog
No files found to lint. Please check your paths and ignore patterns.
[ELIFECYCLE] Command failed with exit code 1.
```

**Root cause.** The scaffold used to live at
`tests/e2e/starter-smoke/work/my-blog`, which the REPOSITORY's `.gitignore`
excludes (`.gitignore:87`). oxlint's directory walker honors ancestor ignore
files, so the starter's own bare `oxlint` found zero files. Reproduced on the
unchanged tree:

```text
$ cd tests/e2e/starter-smoke/work/my-blog && oxlint
No files found to lint. … Finished in 7ms on 0 files   → exit 1
$ cp -R tests/e2e/starter-smoke/work/my-blog <scratch>/lint-outside && cd <scratch>/lint-outside && oxlint
Found 0 warnings and 0 errors. … on 13 files           → exit 0
```

The template's `lint` script was never wrong; the HARNESS location was — a
user's project does not sit inside this repository's ignore rules. The earlier
local proof missed it because it ran through a script-runner shim against a
symlinked mirror at `/tmp`, not the real `pnpm run lint` in the scaffold.

**Fix (minimal, no gate weakening).** New `tests/e2e/starter-smoke/paths.ts`
owns the scaffold location outside the repository (per-run `mkdtemp` root +
pointer file, §7); `setup.ts` recreates the harness-owned subdirectories on
every run, and `quality.ts`, both Playwright configs and `dev.spec.ts` resolve
the same root through that helper. The lint leg still runs the template's own
script, unmodified, and the §4 seeded-error proof shows the gate goes red on a
real lint error while typecheck stays green.

## 6. Contract impact

- No job ID, matrix leg or instance count changed: the release workflow's
  `ci-evidence` required list, `CONTRIBUTING`'s qualification paragraph,
  the internal release procedure (not published) and the known-reds ledger's
  instance claim are untouched and remain true.
- No new `gate:source` step: the gate lives in the packed-consumer harness
  (`@openelement/e2e-starter-smoke`), whose `gate` task is already the pack
  job's entry point; `quality` is a sibling task invoked by its own named step.
- Files: `.github/workflows/autoflow-ci.yml` (one step + job comment),
  `tests/e2e/starter-smoke/quality.ts` (new), `tests/e2e/starter-smoke/paths.ts`
  (new — external mkdtemp root + pointer, §5/§7), `tests/e2e/starter-smoke/setup.ts`,
  `playwright.config.ts`, `playwright.dev.config.ts`, `dev.spec.ts` (all use the
  shared root), `tests/e2e/starter-smoke/package.json` (`quality` script),
  `tests/e2e/starter-smoke/README.md` (task + scratch root documented).

## 7. CodeQL follow-up: predictable temp path → `mkdtemp` + pointer (alerts 4242–4245)

The merge-ref CodeQL analysis on pushed head `91e1aae23` reported four NEW
`js/insecure-temporary-file` warnings in this harness — `setup.ts:295`,
`setup.ts:326`, `dev.spec.ts:106`, `dev.spec.ts:119`. The flow was the one §5
introduced: `paths.ts` derived the root as a FIXED name
(`join(tmpdir()/RUNNER_TEMP, 'openelement-starter-smoke')`), and the harness then
wrote into it (`package.json`, `pnpm-workspace.yaml`, the edited page), which
the analyzer reads as an insecure temporary file.

**Fix.**

- `setup.ts` creates the root with
  `mkdtempSync(join(tmpdir(), 'openelement-starter-smoke-'))` — a unique
  directory per run, never a fixed name. `STARTER_SMOKE_WORK_DIR` is used
  verbatim when the caller sets it (caller-provided is not a temp-path guess).
- The chosen root is recorded in
  `tests/e2e/starter-smoke/node_modules/.starter-smoke-work-dir` (gitignored;
  the harness already requires an install) so the separate processes —
  `setup` → `quality` → Playwright configs → `dev.spec.ts` — resolve the SAME
  tree.
- Readers fail closed with one actionable line
  (`[starter-smoke] no scaffold root recorded: run `pnpm --dir
  tests/e2e/starter-smoke run setup` first …`) instead of inventing a second,
  different root.
- Repeated runs do not leak: `setup` removes the recorded previous root ONLY
  when it is under `tmpdir()` AND its basename starts with the mkdtemp prefix;
  a caller-provided root is never deleted.
- No fixed-name path under the temp dir remains, and `RUNNER_TEMP` is gone.
  Grep proof (`tests/e2e/starter-smoke/**/*.ts`, node_modules excluded):

  ```text
  $ grep -rn "tmpdir()\|RUNNER_TEMP" tests/e2e/starter-smoke --include='*.ts'
  paths.ts:90:  const temp = resolve(tmpdir());            # cleanup validation
  paths.ts:109: const workDir = mkdtempSync(join(tmpdir(), SCRATCH_PREFIX));  # mkdtemp input
  ```

**Re-verification after the fix (real `pnpm`, logs under `<scratch>/templates-ci/`):**

| check | command | result |
| --- | --- | --- |
| setup creates an unpredictable root | `pnpm --dir tests/e2e/starter-smoke run setup` | exit 0; pointer `…/openelement-starter-smoke-WOW9Mv` (random suffix, dir mode 0700) (`setup-mkdtemp.log`) |
| template lint in the new root | `cd <root>/my-blog && pnpm run lint` | 13 files, 0 warnings/0 errors, exit 0 |
| gate green | `vp run --no-cache --fail-if-no-match --filter @openelement/e2e-starter-smoke quality` | exit 0 (`quality-mkdtemp.log`) |
| fail closed, lint-only error | seed `.oxlintrc.json` + `app/components/lint-seed.ts` | `pnpm run typecheck` exit 0; `pnpm run lint` exit 1 ("0 warnings and 1 error"); gate exit 1 at the lint leg (`quality-mkdtemp-seeded.log`); seeds removed → gate exit 0 (`quality-mkdtemp-final.log`) |
| missing pointer fails closed with one line | move the pointer aside, run the gate | exit 1, one line: `error: [starter-smoke] no scaffold root recorded: run … run setup first …` (`quality-no-pointer.log`) |
| Playwright lanes resolve the root | `playwright … --list` (prod 31 tests, dev 4 tests); `--project=chromium` | exit 0 both; 10 passed (9.3s) (`pw-mkdtemp-*.log`) |
| repeat setup cleans the previous root | second `setup` run | old root removed, pointer → new `…-YM4PMD` root, only one harness temp dir remains on disk; quality + `--list` + chromium smoke re-run green on the new root |
