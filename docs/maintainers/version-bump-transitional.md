# Transitional version bump (B2 → alpha9 C5)

> **Status: SUPERSEDED-BY-SCHEDULE.** This manual covers the window after the
> B2 manifest conversion (package.json workspaces, single pnpm lock) and
> before the alpha9 C5 task rewrite lands a new version-bump surface (the
> rewrite was originally scheduled for B5 and moved to alpha9 C5). The moment
> the C5 version-bump task ships, delete this file and follow that task's
> documentation instead. The checks in `tools/repo/version-bump.ts` still
> work and are the fastest path; this manual exists so a release is never
> blocked on remembering which of the former six sites survived.

## What changed in B2

The former SIX-site bump (AGENTS.md "Known repository rituals") is now FIVE
sites, and the per-fixture deno.lock sites are gone entirely:

| former site | status after B2 |
| --- | --- |
| `packages/{element,router,create,ui}/deno.json` `version` | moved → `packages/{element,router,create,ui}/package.json` `version` |
| `packages/create/src/version.ts` `CREATE_VERSION` | unchanged |
| 4× fixture `deno.lock` (`jsr:@openelement/*@<version>` links) | **retired** — the workspace's single `pnpm-lock.yaml` records workspace links as `specifier: workspace:*` / `version: link:packages/<pkg>`, which carry NO version token, so a bump does not touch the lock |
| root `deno.json` / root `deno.lock` | retired with the manifest conversion |

## The bump procedure

1. **Run the pivot.** `tools/repo/version-bump.ts` was converted with B2 and
   drives sites 1–5 (4 package manifests + the create anchor), including the
   dry-run diff, the historical-release-name scan, and the consistency
   re-check:

   ```sh
   pnpm --dir tools/repo run version-bump 1.0.0-alpha.N              # dry run
   pnpm --dir tools/repo run version-bump 1.0.0-alpha.N --write      # apply
   ```

2. **Refresh the lockfile.** The lock records `workspace:*` links without
   versions, so a bump normally produces no lock diff — run it once anyway and
   commit any diff it does produce:

   ```sh
   pnpm install
   git diff --exit-code -- pnpm-lock.yaml || git add pnpm-lock.yaml
   ```

3. **Release bookkeeping by hand** (unchanged by B2, deliberately NOT part of
   the script): `docs/release/release-state.json` `sourceVersion` /
   `activeTarget`, and the CHANGELOG entry. `check-package-graph` and
   `check-release-state-machine` cross-assert these against the package
   versions, so skipping them fails the release train, not the bump.

4. **Verify.** `pnpm --dir tools/repo run version-bump <current-version>`
   (dry run against the just-written tree prints "tree already at …"; with no
   argument the script prints usage and exits 2) plus `pnpm run check`.

## Cross-checks that still guard the five sites

- `pnpm --dir tools/release run graph:check` — every package manifest version
  and `CREATE_VERSION` against `docs/release/release-state.json`
  `sourceVersion` (PACKAGE_VERSION).
- `wwwReleaseAnchorDrift` (inside version-bump's consistency check) — the www
  source-line anchor stays derived from release bookkeeping truth.
- `check-release-state-machine` (`release:registry-check`) — registry truth.

## Why this manual exists

alpha9 C5 owns the version-bump task rewrite (its real scope: what the bump
surface should be once `deno.json`-shaped package truth is gone for good and
the release train is re-plumbed). Until that lands, this file is the
checklist of record. Delete it in the C5 commit.
