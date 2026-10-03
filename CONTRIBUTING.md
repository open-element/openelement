# Contributing to OpenElement

Read [SECURITY.md](./SECURITY.md), [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md), and [MAINTAINERS.md](./MAINTAINERS.md) before contributing.

## Normal changes

1. Start from `dev` and link a focused issue when one exists.
2. Change the product code or canonical documentation and add the smallest useful behavioral test.
3. Run the relevant package scripts and the complete applicable matrix before review.
4. Open a pull request to `dev`; the pull request and exact-SHA Actions checks are the operational record.

Do not commit agent prompts, dispatch transcripts, copied CI logs, temporary evidence, or per-attempt journals.

## Architecture review

Review every change against [docs/architecture/design-principles.md](./docs/architecture/design-principles.md): the four-question gate (P7) applies to ordinary pull requests, and deviations follow the comply-or-explain rule. Use an ADR only for a hard-to-reverse public API, package topology, architecture, security/trust, or explicit compatibility decision. Ordinary fixes do not need an ADR. Current architecture belongs in `docs/architecture`; retired decisions belong in Git history and the compact history index.

Permission note (deliberate): the test suites run on the node host under vitest (B3), so there is no Deno permission surface to scope; subprocess-driving gates may still shell out to the Deno-hosted release/qualify tooling. Supply-chain hygiene (minimum dependency age, lockfiles, provenance checks) remains load-bearing.

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

The root `package.json` scripts are the task surface (`pnpm run <task>`):

| Task                                          | Purpose                                                                                                   |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `check`                                       | `fmt:check` + `lint` + `typecheck` + markdown lint, run serially through `gate.ts`                        |
| `test`                                        | Full vitest suite across every workspace project (see the permission note below)                          |
| `test:e2e`                                    | Site build plus browser end-to-end suites (www, router fixtures)                                          |
| `build`                                       | Build the four public packages (element, router, create, ui)                                              |
| `pack`                                        | Pack release tarballs through `tools/release`                                                             |
| `verify`                                      | Full repository verification, including SaaS                                                              |
| `verify:core`                                 | Element/Router Alpha candidate verification (no SaaS steps)                                               |
| `release:check`                               | Registry check plus the release train (`gate:release`) plus packed qualification plus npm publish dry-run |
| `site:build` / `site:verify`                  | Build / fully verify the documentation site                                                               |
| `saas:build` / `saas:verify` / `saas:workers` | The independently governed SaaS application                                                               |
| `clean` / `clean:deep`                        | Remove generated artifacts                                                                                |
| `bench`                                       | Benchmark self-checks under `benchmarks/` (deterministic assertions, no browsers)                         |
| `fmt` / `fmt:check` / `lint` / `typecheck`    | Format, lint, and type-check the workspace                                                                |
| `gate:release`                                | Source gate's trimmed-out steps plus packed gate (the release train)                                      |

The CI gate is split in two layers. `tools/repo#gate:source` (9 steps) is the
fast PR layer and runs on every pull request; the steps that need a built
Site, coverage, deploy fixtures, or three-engine browser matrices live in
`tools/repo#gate:release` and run on the release train via `release:check`
before anything is published. Nothing is dropped — a step is either in the
PR layer or in the release train.

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

A step is a root task name (`check`) or a directory-scoped task (`tools/repo#release:registry-check`). `parseGateStep` (`tools/repo/gate.ts`) rejects `..` segments and absolute paths, so steps can never escape the repository.

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

`autoflow-ci.yml` has four producers — `fast-checks`, `source-matrix`, `packed-consumers`, `fresh-clone` — plus the aggregation job `autoflow-ci`. The aggregation runs with `if: always()` and asserts each producer result, so a failed or cancelled producer fails the required check explicitly: read the aggregation conclusion first, then open only the failing producer. `saas-optional` is `continue-on-error` by design and never gates the framework candidate.

## Commits

Use Conventional Commits with the prefixes actually in use: `fix`, `feat`, `docs`, `chore`, `refactor`, `test`, `ci`, `release`.

## Release work

Follow [the release operation](./docs/maintainers/releasing.md). Local passes never authorize publication; releases require the exact candidate SHA, green required CI, human review, independent verification, and explicit maintainer approval.
