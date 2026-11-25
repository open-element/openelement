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

## Tracking work

Use an issue for a deliverable that contributors can verify. Describe the
user-visible outcome, the acceptance check and any dependency. A project board
can track the issue through review. Link the pull request and record the result
on the issue when the change lands.

Keep internal assignments, session plans, review transcripts and handoffs in a
separate workspace. Those records can refer to public issue numbers or commits.
Builds, tests, documentation generation and release gates must run from a clean
clone using the repository and its declared dependencies. Public architecture
decisions, compatibility contracts and required release evidence belong here.

## Architecture review

Review every change against [docs/architecture/design-principles.md](./docs/architecture/design-principles.md): the four-question gate (P7) applies to ordinary pull requests — the fields are in the pull request template — and deviations follow the comply-or-explain rule. Current architecture belongs in `docs/architecture`; closed decision records are archived in `docs/legacy/adr/` and remain indexed and annotated in `docs/adr/README.md`. The current view of in-force documents is the generated [architecture index](./docs/architecture/README.md); documents that leave the tree are registered in [docs/history.json](./docs/history.json) and the [archive and removal register](./docs/legacy/README.md).

## When an ADR is required

An ADR is required when a change decides something the codebase cannot reverse cheaply, or when a future maintainer would otherwise have to re-derive the decision from the diff. The triggers are decidable, one by one:

- a public API, package export map, entry subpath or `bin` change consumers can observe — adding one, removing one, or renaming one;
- package topology: adding, removing or splitting a published package, or reversing the dependency direction between packages;
- an architecture boundary a gate enforces: compile/build-time versus runtime split, who may import what, seam ownership, a renderer or style-provider port;
- a security or trust boundary: escaping, sink admission, CSP, auth/session, provenance or supply-chain policy;
- a compatibility decision: a platform or dependency floor, a compatibility layer kept or removed, a named deviation from a platform behavior;
- a governance rule itself: the design principles, a review gate, or a registry a gate reads.

An ADR is NOT required for an ordinary fix, a refactor that leaves the decisions above intact, a test-only change, or documentation that restates an existing decision. When unsure, answer the four questions in the pull request first: if the fourth answer is "our difference is deliberate" and the difference is hard to reverse, write the ADR.

Mechanics: the file is `docs/adr/ADR-NNNN-<slug>.md` with NNNN = the highest existing number + 1, and its entry in `docs/adr/README.md` lands in the same change. `@openelement/tools-repo#adr-index:check` (in `gate:source`) fails when a record is unlisted, a link dangles, or an entry's status annotation disagrees with the record; a record that no longer governs is archived in `docs/legacy/adr/` and annotated `SUPERSEDED` / `RETIRED` / `EXECUTED` in `docs/adr/README.md`, and `AMENDED` marks a partial change.

## Development

Use the Node version in `.node-version` and the pnpm version pinned by
`packageManager`. Install from the lockfile before running workspace commands.
The workspace's `prepare` task installs the shared Git hooks.

```sh
pnpm install --frozen-lockfile
pnpm exec vp run check
pnpm exec vp run --no-cache --fail-if-no-match --filter @openelement/element test
```

Use `vp` with a package's exact name to select a workspace task. A test file
path after the task narrows its Vitest target. The
[development contract](./docs/agent-contract.md#the-canonical-task-entry)
lists the canonical commands, generated files, source gates and packed gates.

Use public package boundaries and Web Platform primitives. Remove displaced
implementations, tests, tasks and documentation together. Changes to
cross-system boundaries need a consumer test and an entry in the
[seams registry](./docs/architecture/seams.md).

## Locating CI failures

Open the failed job in [AutoFlow CI](./.github/workflows/autoflow-ci.yml).
Base CI checks pull requests and pushes to `main`. The local
`tools/repo#gate:source` (20 steps: 19 `@`-qualified tasks plus `check:dep-age`)
runs through `vp run verify:core`. Sixteen of those steps also
run in CI through the fast jobs. The request-time and base-path fixture gates
run in Full qualification. Run `shims:check` and `adr-index:check` locally.

The [release qualification contract](./tools/repo/ci-qualification.ts)
requires the exact-candidate Full dispatch with a successful SHA guard and
every one of the nine qualification job IDs (twelve instances) successful.

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
