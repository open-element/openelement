# Releasing OpenElement

Release state is owned by package manifests, registry state, Git tags, and the small machine-readable `docs/release/release-state.json` record. Do not maintain a second writable status or roadmap projection.

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
  `publish:npm:dry-run`, candidate evidence) on the exact `candidate_sha`;
  the job re-verifies `git rev-parse HEAD == candidate_sha` after checkout.
- Prereleases publish under `--tag alpha|beta|rc` only; `latest` never moves
  onto an alpha (`publishPackage` guard, tested).
- Required pre-publish CI (branch protection on `main`): the AutoFlow CI
  `autoflow-ci`, `node-serve-smoke` (24/26, required), `packed-consumer-matrix`
  (Linux/macOS/Windows packed tarball consumers, required),
  dependency-review on PRs, and CodeQL. `bun-serve-smoke` is an
  optional/non-blocking Bun compatibility signal: it runs with
  `continue-on-error: true`, is not a required check, and never gates the
  candidate or the release graph. Post-publish
  (`published-consumers.yml`) verifies the registry afterward and never
  substitutes for the pre-publish matrix.
