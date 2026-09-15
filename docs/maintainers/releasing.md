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
- `publish:npm` runs only after `release:check` (packed qualification,
  `publish:npm:dry-run`, and the read-only registry-state check) on the exact
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
- Required pre-publish CI (branch protection on `main`): the AutoFlow CI
  `autoflow-ci` aggregation job (which depends on `fast-checks`,
  `source-matrix`, `packed-consumers`, and the isolated `fresh-clone`),
  `node-serve-smoke` (24/26, required), `packed-consumer-matrix`
  (Linux/macOS packed tarball consumers, required),
  `bfcache-chrome` (installed Chrome channel under xvfb; the bundled Chromium
  disables BFCache, so this is the only lane that proves the #943 restore
  contract, required),
  dependency-review on PRs, and CodeQL. The execution jobs run the suite;
  `autoflow-ci` only aggregates and validates their artifacts — it never
  re-runs the suite. `bun-serve-smoke` is an
  optional/non-blocking Bun compatibility signal: it runs with
  `continue-on-error: true`, is not a required check, and never gates the
  candidate or the release graph. The independently governed `apps/saas`
  application is decoupled from the candidate: `tools/repo#gate:source` and
  candidate evidence contain no SaaS step, and `saas-optional` runs with
  `continue-on-error: true`, is not required, and never sets `requiredOk`
  false. Scope is explicit at the task level: `deno task verify:core` is the
  Element/Router Alpha candidate verification, `deno task verify` is the full
  repository verification (including SaaS). Post-publish
  (`published-consumers.yml`) verifies the registry afterward and never
  substitutes for the pre-publish matrix.
