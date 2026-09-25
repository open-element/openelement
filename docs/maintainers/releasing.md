# Releasing OpenElement

Release state is owned by package manifests, registry state, Git tags, and the small machine-readable `docs/release/release-state.json` record. Do not maintain a second writable status or roadmap projection.

`release-state.json` records registry truth **per package**: each package's `latest`/prerelease dist-tags, the latest prerelease's published/missing package partition, and a `commonCompleteVersion` that is the stable version present in **all four** packages or `null` when none exists (it is `null` today — Router has no 0.43.x). Never present a version present in only some packages as the shared published line. A partial publish (some packages shipped, others absent) is represented explicitly, never as one shared version string. `deno task --cwd tools/repo release:state-machine:check` validates that model offline (structure, source versions, Site copy consistency); `deno task --cwd tools/repo release:registry-check` queries npm read-only, recomputes the four-package stable intersection, and fails closed on any drift or false common version — it never publishes or moves a dist-tag, and the ordinary offline `deno task check` does not require network.

## Public 1.0 prerelease baseline

`1.0.0-alpha.1` is the first public 1.0 baseline, not a migration from 0.x. Historic pre-1.0 Git tags remain source snapshots. GitHub Release objects begin with `1.0.0-alpha.1`; release tooling must not require an earlier GitHub Release object.

Public alpha packages use the npm `alpha` dist-tag. npm `latest` stays on the stable line until a separately admitted stable release.

## Candidate procedure

1. Pin the exact candidate SHA and require a clean tracked worktree.
2. Build and pack the intended packages through the release path. See [pack-post-processing](pack-post-processing.md) for what `deno pack` does not do and the deletion condition of each retained step. The only allowed `deno pack` diagnostic is documented with its measured versions and deletion condition in [deno-pack-diagnostic-exception](deno-pack-diagnostic-exception.md); every unknown warning fails the pack.
3. Install actual tarballs in disposable projects outside the workspace and verify exports, declarations, ESM graphs, and the independent Element/Router consumer worlds.
4. Require all applicable Chromium, Firefox, WebKit, Deno, Node, Workers, Bun, and Nitro evidence for claims that remain supported.
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
  `tools/repo#gate:release`, packed qualification, `publish:npm:dry-run`, and
  the read-only registry-state check) on the exact
  `candidate_sha`, and re-verifies `git rev-parse HEAD == candidate_sha` after
  checkout.
- `publish:npm` publishes each package, then verifies every published package's exact version and dist-tag against the registry (continuity is checked per package, not just the first), and writes `.artifacts/release-receipt.json` bound to the exact SHA, tree, and tarball hashes. A partial publish is recorded as `partial` and fails the job instead of reporting success; a re-run safely resumes because already-published versions are skipped. `latest` is never moved onto a prerelease. The workflow uploads `.artifacts/release-receipt.json` with `if: always()` as a recovery record (successful/partial/failed), bound to the candidate SHA and run id/attempt; the receipt is a recovery aid, not proof of a successful publish, and post-publish consumers run only after a complete publish plus registry verification.
- After a successful publish the same workflow chains the published-consumer qualification workflow automatically; it is no longer a manual-only proof.
- The release job refuses to proceed without a successful, non-expired
  `autoflow-ci` artifact for the same SHA: it finds the CI run for that
  commit, downloads the `candidate-evidence-*` artifact, recomputes every log
  and manifest hash, and rejects evidence older than the 14-day retention
  window. Copied or hand-written evidence is never accepted.
- Prereleases publish under `--tag alpha|beta|rc` only; `latest` never moves
  onto an alpha (`publishPackage` guard, tested).
- Required checks for `dev` and `main` (repository ruleset `21775463`):
  `fast-checks`, `source-matrix`, `fresh-clone`, and `packed-consumers` from
  AutoFlow CI, plus `dependency-review`, `CodeQL`, and the strict required
  status-check policy. These producer checks are individually required; the
  `autoflow-ci` aggregate still validates the complete evidence bundle and
  does not re-run the suite. Compatibility probes and the independently
  governed `apps/saas` application are not part of every PR run; use their
  explicit local tasks or dedicated qualification runs when changing those
  surfaces. The SaaS application remains decoupled from the candidate:
  neither `tools/repo#gate:source` nor `tools/repo#gate:release` nor candidate
  evidence contains a SaaS step. Scope is explicit at the task level:
  `deno task verify:core` is the
  Element/Router Alpha candidate verification, `deno task verify` is the full
  repository verification (including SaaS). Post-publish
  (`published-consumers.yml`) verifies the registry afterward and never
  substitutes for the pre-publish matrix.

## Two-tier gates: PR layer and release train

The candidate gate is split so a pull request gets fast, honest feedback
without giving up any release-time proof.

- `tools/repo#gate:source` — the PR source layer (nine steps): `generate:all`,
  `typecheck`, the Element and Router unit suites, markdown lint, the
  content-dates timing check, the public-interface snapshot, the
  request-time fixture gate, and the Element browser gate (Chromium). The
  separate packed producer owns `tools/release#gate:packed`; the independent
  fresh-clone lane runs source and packed once each with cold Deno/npm caches.
  A green `deno task gate:ci` runs source plus packed locally.
- `tools/repo#gate:release` — the release train: Site build and every `www`
  check, coverage, all deploy/framework fixture gates, the boundary and
  provenance scans, the generator/floor/classification gates, the
  three-engine Site E2E suite and the full three-engine Element browser
  conformance matrix. `deno task release:check` runs it (plus registry
  truth, the packed gate, and the publish dry-run) before anything is
  published, so every trimmed step is still a precondition of release.

The candidate's Site E2E proof is produced by the PR-layer `fresh-clone`
lane, which stages its sidecar and raw Playwright report into the candidate
evidence; the release job still refuses to proceed unless that evidence
validates against the exact candidate SHA. Trimming the PR layer therefore
changes **when** the heavier proofs run, never whether they are required to
ship.

The top-level task count is not a work count. Before the alpha5 de-duplication,
`gate:source` called `gate:packed` internally, so the source producer, the
independent packed producer, and fresh-clone's source plus explicit packed step
could run the complete packed gate four times on one non-reused PR. Removing
that nested call leaves two complete packed runs (packed producer and isolated
fresh-clone). Node 24/26 serving and Linux/macOS starter jobs still pack their
own current-SHA tarballs; no unmeasured wall-time saving is asserted.

## Tree-identical evidence reuse

The reuse job may select one successful AutoFlow CI evidence package for the
same Git tree within the artifact-retention window. Every producer needs
`actions: read` to download its source-run artifact. Its claim verifies the
producer commit's tree in the checkout before stamping the job record with
`reused: { runId, sha }`; `sha` names the commit that actually ran the gate,
not a later commit that forwarded its evidence. The aggregate independently
checks the tree, stamps, log hashes, tarball hashes, and the Site E2E report.
A failed resolution or claim runs the real gate after discarding an
unclaimable download. Nothing accepts a partial mix of source runs.

To distinguish a replay from fresh execution, inspect each producer's
`result.json` in the `candidate-evidence-*` artifact: a replay has the
`reused` stamp and its `sha` is the original producer. Fresh execution has
no stamp and its command logs show the gate running for the candidate SHA.
The run summary reports the resolver decision, but the per-job records and
aggregate audit are the authority. Reuse never grants publication by itself:
the Release workflow still requires a green, non-expired AutoFlow CI bundle
for the exact candidate SHA.

The suite runs with `--retries 1`, and a retry is part of the contract: a test
that timed out and passed on the retry is Playwright's `flaky` (kept out of
`stats.expected`, never out of `stats.unexpected`), so the proof counts it as a
pass and records it in the sidecar's `flaky` rather than discarding it. The
suite-size identity is therefore `expected + flaky == executed tests`, and
`failed` still means the final attempt failed. A sidecar cannot under- or
over-report retries: the recompute binds `flaky` to the raw report's own
`stats.flaky`, so the fact has to be in the bytes.
