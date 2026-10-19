# Releasing OpenElement

Release state is owned by package manifests, registry state, Git tags, and the small machine-readable `docs/release/release-state.json` record. Do not maintain a second writable status or roadmap projection.

`release-state.json` records registry truth **per package**: each package's `latest`/prerelease dist-tags, the latest prerelease's published/missing package partition, and a `commonCompleteVersion` that is the stable version present in **every published package** or `null` when none exists (it is `null` today). Never present a version present in only some packages as the shared published line. A partial publish (some packages shipped, others absent) is represented explicitly, never as one shared version string. `pnpm --dir tools/repo run release:state-machine:check` validates that model offline (structure, source versions, Site copy consistency); `pnpm --dir tools/repo run release:registry-check` queries npm read-only, recomputes the stable intersection, and fails closed on any drift or false common version — it never publishes or moves a dist-tag, and the ordinary offline `pnpm run check` does not require network.

## Registry truth is written, not remembered

The tracked registry block used to be updated by hand after each publish, and it lagged: alpha.12 shipped while both `release-state.json` and the site still named alpha.11, so the homepage advertised a version the registry no longer served. The publish train now ends with one read-back (`tools/release/registry-sync.ts`):

- `publishRelease` (inside `publish:npm`) runs the sync after a complete publish and registry verification. It re-reads every published package's dist-tags and version list with read-only `npm view`, rewrites the tracked block (`registry.verifiedAt`, `method`, each published package's dist-tags, `latestPrerelease`), projects the result into `www/app/data/version.ts` (`PUBLISHED_LATEST`, `UNRELEASED_PACKAGES`), and regenerates `www/app/data/_generated-release-line.ts` through the site's own content generator. A query or a write failing fails the release job.
- The release job runs the same sync a **second time after the alpha alias re-point** (`sync:registry` in `autoflow-release.yml`). The first read-back happens inside `publish:npm`, before the alias step, so it records `alpha` as it stood before the re-point; the second run records the post-re-point alias. Recording only the first would leave the tracked `alpha` entry one release behind and make the next release fail the drift check on files the publish train itself wrote. Both runs fail the job on an error.
- The synced files are **not** pushed by the job: `main` requires a pull request and the release job holds no push identity. The workflow uploads them as the `registry-release-state` artifact, and a maintainer lands them through the ordinary PR path (same files every time: `docs/release/release-state.json`, `www/app/data/version.ts`, `www/app/data/_generated-release-line.ts`).
- Until that PR lands, `@openelement/tools-release#registry-drift:check` fails when the displayed version values no longer match what npm serves, or when the tracked block disagrees with the registry. It is wired into `@openelement/tools-repo#gate:release` beside `release:state-machine:check`; no CI workflow runs that gate on its own, so the readers are the maintainer running `pnpm run release:check` before a publish and the release train itself. Without network it prints a `SKIP` line naming the reason and passes — an explicit, visible skip, never a silent pass — but findings already established from the packages that answered are still reported and still fail the run; any non-network query failure (auth, malformed answer) is a red. (The PR job runs `release:state-machine:check` only, so a drift the maintainer does not run the gate for is caught at the next publish, not on the PR.)

## Public 1.0 prerelease baseline

`1.0.0-alpha.1` is the first public 1.0 baseline, not a migration from 0.x. Historic pre-1.0 Git tags remain source snapshots. GitHub Release objects begin with `1.0.0-alpha.1`; release tooling must not require an earlier GitHub Release object.

Public alpha packages use the npm `alpha` dist-tag. For pre-1.0 lines the
npm `latest` tag stays on the stable line until a separately admitted stable
release — but from the 1.0 line onward the prerelease IS the shipping line:
`publishPackage` publishes 1.0.0-prereleases onto `latest` and keeps the
channel tag (`alpha`) as an alias the release workflow re-points after the
publish (owner ruling 2026-10-07; see `npmPublishTag`, tested).

## Candidate procedure

1. Pin the exact candidate SHA and require a clean tracked worktree.
2. Build and pack the intended packages through the release path. See [pack-post-processing](pack-post-processing.md) for what the generator (`vp pack`) does not do and the deletion condition of each retained step. The deno-pack diagnostic exception is retired with the A1 toolchain swap (audit trail in [deno-pack-diagnostic-exception](deno-pack-diagnostic-exception.md); do not reintroduce the classifier) — every pack warning now fails the pack closed.
3. Install actual tarballs in disposable projects outside the workspace and verify exports, declarations, ESM graphs, and the independent Element/Router consumer worlds.
4. Require all applicable Chromium, Firefox, WebKit, Node, Workers, Bun, and Nitro evidence for claims that remain supported.
5. Require green exact-SHA CI, CodeQL/security checks, human review, and a fresh independent verifier.
6. Obtain explicit publication approval before creating tags, publishing packages, changing dist-tags, or creating the GitHub Release.

Never use a release-deletion option that also deletes tags. Never publish from copied logs or evidence generated for another SHA.

## Release authorization contract

The `Release` workflow (`autoflow-release.yml`, `workflow_dispatch` only)
publishes only through the `openelement-release` GitHub environment. The
environment is platform configuration, not code — the workflow binds the
name, and these settings must exist in the repository settings before any
publish; a missing environment fails the job closed instead of publishing:

- Environment `openelement-release` with required reviewers (at least one
  maintainer human approval; dispatches are not self-approving).
- No long-lived npm token in secrets: authentication is npm Trusted
  Publishing via the workflow's `id-token: write` OIDC claim. The publish
  step passes `--provenance` only under `GITHUB_ACTIONS=true`, so local runs
  can never mint registry attestations.
- `publish:npm` runs only after `release:check` (the release train
  `@openelement/tools-repo#gate:release`, packed qualification,
  `publish:npm:dry-run`, and
  the read-only registry-state check) on the exact dispatched `main`
  SHA, and re-verifies `git rev-parse HEAD` equals that dispatched SHA after
  checkout.
- `publish:npm` publishes each package, then verifies every published package's exact version and dist-tag against the registry (continuity is checked per package, not just the first), and writes `.artifacts/release-receipt.json` bound to the exact SHA, tree, and tarball hashes. That receipt is a **local** recovery aid, not proof of a successful publish: the workflow does not upload it — the only artifact the release job uploads is the `registry-release-state` bundle described above. A partial publish is recorded as `partial` and fails the job instead of reporting success; a re-run safely resumes because already-published versions are skipped. (For the tag each line publishes under, see "Public 1.0 prerelease baseline" — the 1.0 line publishes onto `latest`.) Post-publish consumers run only after a complete publish plus registry verification.
- After a successful publish the same workflow chains the published-consumer qualification workflow automatically; it is no longer a manual-only proof.
- The release job (`ci-evidence`) discovers the official AutoFlow CI push run
  for the exact dispatched `main` SHA over the GitHub API — no run id, artifact,
  or log is supplied by the dispatcher. It requires the run conclusion
  `success` **and** every instance of the nine required qualification job IDs
  to be `success`: `lint`, `test`, `e2e`, `pack`, `e2e-full` (two instances),
  `bfcache`, `node-serve-smoke` (two), `packed-consumer-matrix` (two), and
  `fresh-install` — twelve job instances in total, with `sha-guard` binding the
  run to the dispatched SHA. A missing, skipped, cancelled or non-successful
  required job refuses the publish; there is no artifact to copy or hand-write.
- Prereleases publish under `--tag alpha|beta|rc` for pre-1.0 lines; the 1.0
  line publishes onto `latest` and rides the channel tag as a re-pointed alias
  (`npmPublishTag`, tested — see "Public 1.0 prerelease baseline"). A pre-1.0
  prerelease still never moves `latest` onto itself.
- Required checks for `main` (repository ruleset `24288967`):
  `lint`, `test`, `e2e`, and `pack` from AutoFlow CI, plus `CodeQL` and the
  strict required status-check policy. These checks are individually required
  and each is a job in its own right — there is no aggregation job to read; the
  Release workflow's `ci-evidence` job performs the full-run verification
  described above before anything publishes. Compatibility probes and the
  independently governed `apps/saas` application are not part of every PR run;
  use their explicit local tasks or dedicated qualification runs when changing
  those surfaces. The SaaS application remains decoupled from the candidate:
  neither `@openelement/tools-repo#gate:source` nor
  `@openelement/tools-repo#gate:release` nor the CI evidence contains a SaaS
  step. Scope is explicit at the task level:
  `pnpm run verify:core` is the
  Element/Router Alpha candidate verification, `pnpm run verify` is the full
  repository verification (including SaaS). Post-publish
  (`published-consumers.yml`) verifies the registry afterward and never
  substitutes for the pre-publish matrix.

## Two-tier gates: PR layer and release train

The candidate gate is split so a pull request gets fast, honest feedback
without giving up any release-time proof.

- `@openelement/tools-repo#gate:source` — the local source gate (sixteen
  steps: fifteen `@`-qualified tasks plus `check:dep-age`; the `gate:source`
  script in `tools/repo/package.json` is the authoritative list and count):
  `generate:all`, `typecheck`, the dependency-age quarantine check, the
  Element and Router unit suites, markdown lint, the vp-selector-flags check,
  `seams:check`, `shims:check`, `adr-index:check`, the content-dates manifest
  check, `www#check:doc-claims`, the public-interface snapshot, the request-time
  and base-path fixture gates, and the Element browser gate (Chromium). No
  workflow invokes this task; `pnpm run verify` and `pnpm run verify:core`
  are its entry points. Eleven of those steps also run in AutoFlow CI through
  the `lint` and `test` jobs — `generate:all`, the `tools/` project's
  `@openelement/tools-repo#typecheck`, the dependency-age check, markdown lint
  (inside `vp run check`), the vp-selector-flags check, `seams:check`, the
  content-dates manifest check and the public-interface snapshot in `lint`;
  both unit suites and the Chromium browser gate in `test` — while the
  request-time and base-path fixture gates run only in the
  `e2e-full` full-qualification layer (main pushes and `full_qualification`
  dispatches), and `shims:check`, `adr-index:check` and `www#check:doc-claims`
  are local-only until a workflow adopts them, so a PR can be green while they
  are unexercised. The separate
  `pack` job owns `@openelement/tools-release#gate:packed`; the
  `fresh-install` job runs the cold-cache install/typecheck proof only on the
  `main` push and full-qualification layer. A green
  `pnpm run verify:core` runs source plus packed locally.
- `@openelement/tools-repo#gate:release` — the release train: Site build and every `www`
  check, coverage, all deploy/framework fixture gates, the boundary and
  provenance scans, the generator/floor/classification gates, the
  three-engine Site E2E suite and the full three-engine Element browser
  conformance matrix. `pnpm run release:check` runs it (plus registry
  truth, the packed gate, and the publish dry-run) before anything is
  published, so every trimmed step is still a precondition of release.

The candidate's Site E2E proof is the `e2e` job on every PR (Chromium only)
and the three-engine `e2e-full` site instance on a `main` push, where the full
suite runs through `www#e2e:browsers` (`--retries 1`). The release job requires
every required job instance of the exact-SHA `main` push run to be `success`
(see "Release authorization contract"), so trimming the PR layer changes
**when** the heavier proofs run, never whether they are required to ship.

The top-level task count is not a work count. Before the alpha5 de-duplication,
`gate:source` called `gate:packed` internally, so the source gate, the
independent `pack` job, and other packed invocations could run the complete
packed gate several times on one PR. Removing that nested call leaves the
`pack` job's packed proof as the producer and `fresh-install`'s own cold
install/typecheck run. Node 24/26 serving and Linux/macOS starter jobs still
pack their own current-SHA tarballs; no unmeasured wall-time saving is
asserted.

## Evidence reuse was retired

Tree-identical evidence reuse (ADR-0156) let a producer replay a previous
run's evidence for the same Git tree. The #1567 CI redesign removed the reuse
resolver, the evidence aggregator, and the `claim-reused-evidence` action: the
release gate now reads the exact-SHA CI run's job conclusions from the GitHub
API (see "Release authorization contract"), and a run's evidence cannot be
forwarded across SHAs or trees. ADR-0156 keeps the decision history and
records the retirement; no workflow emits or consumes `candidate-evidence-*`
artifacts.

The site E2E suite runs with `--retries 1`, and a retry is part of the
contract: a test that timed out and passed on the retry is Playwright's
`flaky`, so the run's audit counts it as a pass while keeping it
distinguishable from `expected`; a test that fails its final attempt is still
`unexpected` and fails the run. The suite-size identity is therefore
`expected + flaky == executed tests`, and `failed` still means the final
attempt failed.

## Release-evidence automation (alpha15)

Four local entry points own the pre-approval evidence work; none of them is a CI
gate, so the pinned workflow step counts are unchanged:

- `node tools/release/evidence-bind.ts --sha <sha> [--pr <n>] [--repo <owner/name>]
  [--codeql-repo <owner/name>] [--require-main-push]` — the exact-SHA evidence
  binder: CI run/attempt/conclusion with per-job-instance conclusions, artifacts,
  the authoritative CodeQL alert list for the PR merge ref, the six npm
  dist-tags, and tag/Release presence. It fails closed on a SHA mismatch, on a
  cancelled or failed run cited as qualification, on a missing/non-success
  required instance, and on an unqueried dimension; a run qualifies only when
  its own instances satisfy the nine-job/twelve-instance contract. `--check`
  re-evaluates a recorded document offline. Its output is the PR/release
  checklist snippet — do not hand-write that table.
- `node tools/release/verify-evidence-archive.ts [--archive <path> | --url <url>]`
  — verifies the raw A/B + JFB measurement package before approval: the pinned
  sha256 and byte size, every member hash, the 86/22 assertion reproducers, and
  the JFB numbers recomputed from the raw per-invocation JSON against both
  `jfb/metrics.json` and the evaluation document. The tracked fetch path is in
  `docs/release/evidence/alpha15/README.md` (evidence-only prerelease on the
  release fork; obtainable before the publication Release exists).
- `node tools/release/check-toolchain-pins.ts` — the fixed-toolchain audit:
  Node (`.node-version`), pnpm (`packageManager`), Playwright
  (`devDependencies` + lockfile) and the `tools/release/toolchain/Dockerfile` recipe
  must agree, together with the CI workflows and the toolchain README.
- `node tools/release/release-preflight.ts [--run-local] [--execute
  --authorize-destructive --confirm-sha <sha>]` — one-command preflight that
  composes the read-only verifiers, the existing gate entry points (read from
  `package.json` script names), the evidence binding and the owner-gated
  tag/publish/Release/asset/dist-tag sequence with read-backs. Dry run by
  default; destructive steps are refused unless explicitly authorized, and even
  then the tool only prints them — the `Release` workflow owns publication
  through the `openelement-release` environment.

The reproducible toolchain image recipe is `tools/release/toolchain/Dockerfile` +
`tools/release/toolchain/README.md` (build it, record the resolved image digests, then
run the gates with the repository bind-mounted). The batch retrospective is an internal working record and is not published.
