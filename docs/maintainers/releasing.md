# Releasing OpenElement

Release state is owned by package manifests, registry state, Git tags, and the small machine-readable `docs/release/release-state.json` record. Do not maintain a second writable status or roadmap projection.

## Public 1.0 prerelease baseline

`1.0.0-alpha.1` is the first public 1.0 baseline, not a migration from 0.x. Historic pre-1.0 Git tags remain source snapshots. GitHub Release objects begin with `1.0.0-alpha.1`; release tooling must not require an earlier GitHub Release object.

Public alpha packages use the npm `alpha` dist-tag. npm `latest` stays on the stable line until a separately admitted stable release.

## Candidate procedure

1. Pin the exact candidate SHA and require a clean tracked worktree.
2. Build and pack the intended packages through the release path.
3. Install actual tarballs in disposable projects outside the workspace and verify exports, declarations, ESM graphs, and the independent Element/Router consumer worlds.
4. Require all applicable Chromium, Firefox, WebKit, Deno, Node, Workers, Bun, and Nitro evidence for claims that remain supported.
5. Require green exact-SHA CI, CodeQL/security checks, human review, and a fresh independent verifier.
6. Obtain explicit publication approval before creating tags, publishing packages, changing dist-tags, or creating the GitHub Release.

Never use a release-deletion option that also deletes tags. Never publish from copied logs or evidence generated for another SHA.
