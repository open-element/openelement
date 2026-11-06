# Contributing to OpenElement

Read [SECURITY.md](./SECURITY.md) and [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) before contributing.

## Normal changes

1. Start from `main` and link a focused issue when one exists.
2. Change the product code or canonical documentation and add the smallest useful behavioral test.
3. Run the relevant package scripts and the complete applicable matrix before review.
4. Open a pull request to `main`; the pull request and exact-SHA Actions checks are the operational record.

Do not commit agent prompts, dispatch transcripts, copied CI logs, temporary evidence, or per-attempt journals.

## Completion, CI and evidence policy

A change is complete when the required checks of the `main` ruleset — `lint`,
`test`, `e2e`, `pack` and `CodeQL` — are green on the exact pull-request head
that merges. A local pass, a cancelled or skipped job, and a prototype are not
completion evidence.

- **Local evidence must be reproducible.** Record the SHA the evidence was
  produced at, the exact commands, the result (exit code or summary), and the
  toolchain the run used (the pinned Node and pnpm; the browser revision when
  browser evidence is claimed). Evidence produced at a different commit is not
  evidence for the head under review.
- **CI green is the verdict.** Reconcile locally — merge, generate, check,
  focused tests, full diff review — before pushing; CI is not the debugger. A
  red required check blocks merge, and a pending or partially-run pipeline must
  not be described as passing.
- **CI flakes are recorded, not silently rerun.** When a rerun is needed, the
  pull-request thread (or a tracked note linked from it) records the original
  failing job/step and its error, why the failure is environmental rather than a
  product regression, the rerun's attempt, and the result. A rerun changes the
  evidence; it does not erase the failure from the record.
- **Gate claims cite the execution-plan unit.** The pull request names the
  milestone or gate it claims (an M row, G1/G2, a slice) and the commands behind
  each claim. A prototype or spike is labelled "NOT G1" / "not a gate record";
  a prototype or a local run must never be written up as a gate, qualification
  or release evidence — see
  [docs/architecture/alpha16-18-progress.md](./docs/architecture/alpha16-18-progress.md)
  for the tracked statuses.

## Architecture review

Review every change against [docs/architecture/design-principles.md](./docs/architecture/design-principles.md): the four-question gate (P7) applies to ordinary pull requests — the fields are in the pull request template — and deviations follow the comply-or-explain rule. Current architecture belongs in `docs/architecture`; retired decisions are retained in `docs/adr` and annotated there.

## When an ADR is required

An ADR is required when a change decides something the codebase cannot reverse cheaply, or when a future maintainer would otherwise have to re-derive the decision from the diff. The triggers are decidable, one by one:

- a public API, package export map, entry subpath or `bin` change consumers can observe — adding one, removing one, or renaming one;
- package topology: adding, removing or splitting a published package, or reversing the dependency direction between packages;
- an architecture boundary a gate enforces: compile/build-time versus runtime split, who may import what, seam ownership, a renderer or style-provider port;
- a security or trust boundary: escaping, sink admission, CSP, auth/session, provenance or supply-chain policy;
- a compatibility decision: a platform or dependency floor, a compatibility layer kept or removed, a named deviation from a platform behavior;
- a governance rule itself: the design principles, a review gate, or a registry a gate reads.

An ADR is NOT required for an ordinary fix, a refactor that leaves the decisions above intact, a test-only change, or documentation that restates an existing decision. When unsure, answer the four questions in the pull request first: if the fourth answer is "our difference is deliberate" and the difference is hard to reverse, write the ADR.

Mechanics: the file is `docs/adr/ADR-NNNN-<slug>.md` with NNNN = the highest existing number + 1, and its entry in `docs/adr/README.md` lands in the same change. `@openelement/tools-repo#adr-index:check` (in `gate:source`) fails when a record is unlisted, a link dangles, or an entry's status annotation disagrees with the record; a record that no longer governs is retained and annotated `SUPERSEDED` / `RETIRED` / `EXECUTED`, and `AMENDED` marks a partial change.

Permission note (deliberate): the test suites run on the node host under vitest (B3), and the whole toolchain is Node/pnpm end to end after the S2 release-lane port, so there is no Deno permission surface to scope. Supply-chain hygiene (minimum dependency age, lockfiles, provenance checks) remains load-bearing.

## Development

Use the Node version pinned in `.node-version` (24.18) and the pnpm version
pinned by `packageManager`. After cloning, materialize `node_modules` first:

```sh
pnpm install
```

Then install the shared git hooks — `core.hooksPath` is unset in a fresh
clone, so the `fmt`/`lint` pre-commit and fuller pre-push gates stay
inactive until you run:

```sh
pnpm --dir tools/repo run hooks:install
```

```sh
pnpm run fmt:check
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run build
```

Use public package boundaries rather than private workspace imports. Prefer Web Platform primitives and established tools. Remove displaced implementations, tests, tasks, and documentation together.

## Task map

The root `package.json` scripts are the task surface (`pnpm run <task>`); workspace tasks dispatch
package-qualified through the vp CLI (`vp run --no-cache --fail-if-no-match --filter <@scope/pkg> <task>`),
which selects by exact package name:

| Task                                          | Purpose                                                                                                   |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `check`                                       | `fmt:check` + `lint` + `typecheck` + markdown lint, run serially through `gate.ts`                        |
| `test`                                        | Full vitest suite across every workspace project (see the Architecture review permission note)            |
| `test:e2e`                                    | Site build plus browser end-to-end suites (www, router fixtures)                                          |
| `build`                                       | Build the six public packages (protocol, element, compiler, router, create, ui)                           |
| `vp run --no-cache --fail-if-no-match --filter @openelement/tools-release pack` | Pack release tarballs through `tools/release`                                                            |
| `verify`                                      | Full repository verification, including SaaS                                                              |
| `verify:core`                                 | Element/Router Alpha candidate verification (no SaaS steps)                                               |
| `release:check`                               | Registry check plus the release train (`gate:release`) plus packed qualification plus npm publish dry-run |
| `site:build` / `site:verify`                  | Build / fully verify the documentation site                                                               |
| `saas:verify` / `saas:workers`                | The independently governed SaaS application (`vp run --no-cache --fail-if-no-match --filter @openelement/saas build` builds it) |
| `clean` / `clean:deep`                        | Remove generated artifacts                                                                                |
| `bench`                                       | Benchmark self-checks under `benchmarks/` (deterministic assertions, no browsers)                         |
| `fmt` / `fmt:check` / `lint` / `typecheck`    | Format, lint, and type-check the workspace                                                                |
| `gate:release`                                | Source gate's trimmed-out steps plus packed gate (the release train)                                      |

The gates are split in two layers. CI's fast PR layer is the `lint`, `test`,
`e2e`, and `pack` jobs in `.github/workflows/autoflow-ci.yml`, and it runs on
every pull request targeting `main` and on pushes to `main` and
`alpha15-consolidation`. `tools/repo#gate:source` (16
steps: fifteen `@`-qualified tasks plus `check:dep-age`) is the LOCAL source
gate: no workflow invokes the aggregate task, and `pnpm run verify`
and `pnpm run verify:core` are its entry points. Eleven of those steps also
run in CI through the fast jobs — `@openelement/tools-repo#typecheck` (the
`tools/` project), the dependency-age quarantine, markdown lint (inside
`vp run check`), the vp-selector flags check, the seams registry, the
content-date manifest, the interface snapshot, `generate:all`, and the
Element/Router unit suites plus the Chromium browser gate. The request-time and
base-path fixture gates stay outside the fast layer, in the `e2e-full`
full-qualification layer (main pushes and `full_qualification` dispatches), and
`shims:check`, `adr-index:check` and `www#check:doc-claims` are local-only
until a workflow adopts them —
so run `pnpm run verify:core` before relying on those. The steps that need
a built Site, coverage, deploy
fixtures, or three-engine browser matrices live in `tools/repo#gate:release`
and run on the release train via `release:check` before anything is published.

```bash
pnpm run check                                    # fmt + lint + typecheck + markdown
pnpm --dir tools/repo run release:registry-check  # one directory-scoped task
pnpm --filter @openelement/router run test        # one task in one workspace member
pnpm run verify:core                              # core candidate verification (no SaaS)
pnpm run verify                                   # full repository (including SaaS)
pnpm run gate:release                             # the release train (trimmed-out steps)
```

Subtask areas: `tools/repo` (gates, release-state checks, coverage, hooks), `tools/release` (pack, publish dry-run, packaged consumers), `www` (site generation, content/link/theme checks, browser e2e), `apps/saas` (`check`, `test`, Nitro builds — separately governed, never blocking).

## gate.ts usage

`gate.ts` runs steps serially and stops at the first failure:

```bash
node tools/repo/gate.ts <step...>
```

A step is a root task name (`check`) or a package-qualified task (`@openelement/tools-repo#release:registry-check`); each step dispatches through `vp run --no-cache --fail-if-no-match --filter <package> <task>`, so a selector that names no package fails the gate instead of silently skipping. `parseGateStep` (`tools/repo/gate.ts`) rejects the path-shaped `dir#task` selector form (it cannot be dispatched), `..` segments and absolute paths, so steps can never escape the repository.

## Hooks

```bash
pnpm --dir tools/repo run hooks:install    # git config core.hooksPath .githooks + chmod pre-commit/pre-push
pnpm --dir tools/repo run hooks:uninstall  # unset core.hooksPath
```

## Single-package and single-file tests

```bash
pnpm --filter @openelement/router run test
pnpm exec vitest run --project element packages/element/__tests__/compiled-escape-parity.test.ts
```

Package test tasks run vitest on the node host; a single file runs through the same vitest invocation narrowed by the file path (see the permission note in the Architecture review section).

## Locating CI failures

`autoflow-ci.yml` runs a `sha-guard` job first, then the fast PR layer (`lint`, `test`, `e2e`, `pack`); the heavy qualification jobs — `e2e-full` (two instances: the three-engine site E2E suite and the fixture gates), `bfcache`, `node-serve-smoke` (Node 24 and 26), `packed-consumer-matrix` (Linux and macOS), and `fresh-install` — run on a `main` push and on a `full_qualification` dispatch. There is no aggregation job: each required check is the job itself, so read the failing job's log directly. The Release workflow's `ci-evidence` job separately requires every one of the nine qualification job IDs (twelve instances) of the exact-SHA `main` push run to be `success`; `apps/saas` is never part of the candidate.

## Commits

Use Conventional Commits with the prefixes actually in use: `fix`, `feat`, `docs`, `chore`, `refactor`, `test`, `ci`, `release`.

### Developer Certificate of Origin (DCO)

Contributions are accepted under the Developer Certificate of Origin 1.1
(<https://developercertificate.org/>): every commit must carry a
`Signed-off-by: Name <email>` trailer whose name and email match the commit
author, certifying that you have the right to submit the change under this
repository's MIT license (inbound = outbound).

Create signed-off commits with `git commit -s`. Repair a branch that is missing
trailers with `git rebase --signoff <base>`; keep the trailer when you rebase,
amend or squash. Do not rewrite already-published history to add trailers.
Automated bot commits (dependabot, renovate, and the repository service
identities) are out of scope.

## Release work

Follow the release gate sequence in the [release workflow](./.github/workflows/autoflow-release.yml). Local passes never authorize publication; releases require the exact candidate SHA, green required CI, human review, independent verification, and explicit maintainer approval.
