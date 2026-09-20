# Contributing to OpenElement

Read [SECURITY.md](./SECURITY.md), [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md), and [MAINTAINERS.md](./MAINTAINERS.md) before contributing.

## Normal changes

1. Start from `dev` and link a focused issue when one exists.
2. Change the product code or canonical documentation and add the smallest useful behavioral test.
3. Run the relevant Deno tasks and the complete applicable matrix before review.
4. Open a pull request to `dev`; the pull request and exact-SHA Actions checks are the operational record.

Do not commit agent prompts, dispatch transcripts, copied CI logs, temporary evidence, or per-attempt journals.

## Architecture review

Review every change against [docs/architecture/design-principles.md](./docs/architecture/design-principles.md): the four-question gate (P7) applies to ordinary pull requests, and deviations follow the comply-or-explain rule. Use an ADR only for a hard-to-reverse public API, package topology, architecture, security/trust, or explicit compatibility decision. Ordinary fixes do not need an ADR. Current architecture belongs in `docs/architecture`; retired decisions belong in Git history and the compact history index.

Permission note (deliberate): the root `test` task and coverage run with full Deno permissions, including `--allow-ffi`, for contributor convenience. `--allow-ffi` can load local dynamic libraries, which in practice dissolves the sandbox — a poisoned dependency could move laterally into CI and developer machines. This risk is accepted by the maintainer; do not "fix" it by narrowing flags, and treat supply-chain hygiene (minimum dependency age, lockfiles, provenance checks) as load-bearing.

## Development

Use the Deno version pinned in `.dvmrc`. After cloning, materialize
`node_modules` first — the workspace sets `nodeModulesDir: "manual"`, so
npm: specifiers resolve only from a local install:

```sh
deno install
```

```sh
deno task fmt:check
deno task lint
deno task typecheck
deno task test
deno task build
```

Use public package boundaries rather than private workspace imports. Prefer Web Platform primitives and established tools. Remove displaced implementations, tests, tasks, and documentation together.

## Task map

The root `deno.json` defines 20 tasks:

| Task                                          | Purpose                                                                            |
| --------------------------------------------- | ---------------------------------------------------------------------------------- |
| `check`                                       | `fmt:check` + `lint` + `typecheck` + markdown lint, run serially through `gate.ts` |
| `test`                                        | Full Deno test suite with full permissions (see the permission note below)         |
| `test:e2e`                                    | Site build plus browser end-to-end suites (www, router fixtures)                   |
| `build`                                       | Build the four public packages (element, router, create, ui)                       |
| `pack`                                        | Pack release tarballs through `tools/release`                                      |
| `verify`                                      | Full repository verification, including SaaS                                       |
| `verify:core`                                 | Element/Router Alpha candidate verification (no SaaS steps)                        |
| `release:check`                               | Registry check plus packed qualification plus npm publish dry-run                  |
| `site:build` / `site:verify`                  | Build / fully verify the documentation site                                        |
| `saas:build` / `saas:verify` / `saas:workers` | The independently governed SaaS application                                        |
| `clean` / `clean:deep`                        | Remove generated artifacts                                                         |
| `fmt` / `fmt:check` / `lint` / `typecheck`    | Format, lint, and type-check the workspace                                         |
| `gate:ci`                                     | Source gate plus packed gate (the fast local equivalent of CI producers)           |

Workspace subtasks run two ways: by directory (`--cwd`) or by member (`--filter`):

```bash
deno task check                                   # fmt + lint + typecheck + markdown
deno task --cwd tools/repo release:registry-check # one directory-scoped task
deno task --filter @openelement/router test       # one task in one workspace member
deno task verify:core                             # core candidate verification (no SaaS)
deno task verify                                  # full repository (including SaaS)
```

Subtask areas: `tools/repo` (gates, release-state checks, coverage, hooks), `tools/release` (pack, publish dry-run, packaged consumers), `www` (site generation, content/link/theme checks, browser e2e), `apps/saas` (`check`, `test`, Nitro builds — separately governed, never blocking).

## gate.ts usage

`gate.ts` runs steps serially and stops at the first failure:

```bash
deno run --allow-run tools/repo/gate.ts <step...>
```

A step is a root task name (`check`) or a directory-scoped task (`tools/repo#release:registry-check`). `parseGateStep` (`tools/repo/gate.ts`) rejects `..` segments and absolute paths, so steps can never escape the repository.

## Hooks

```bash
deno task --cwd tools/repo hooks:install    # git config core.hooksPath .githooks + chmod pre-commit/pre-push
deno task --cwd tools/repo hooks:uninstall  # unset core.hooksPath
```

## Single-package and single-file tests

```bash
deno task --filter @openelement/router test
cd packages/element && deno test --deny-ffi --no-prompt --allow-read --allow-write --allow-env --allow-net --allow-run __tests__/compiled-escape-parity.test.ts
```

Package test tasks may narrow the default permission set (element uses `--deny-ffi`); mirror the flags from the package's own `test` task when running a single file. The root `test` task intentionally runs with full Deno permissions including `--allow-ffi`: this is a convenience decision, not an oversight — `--allow-ffi` can load local dynamic libraries, which in practice dissolves the sandbox, so treat dependency supply-chain hygiene as load-bearing (see the permission note in the Architecture review section).

## Locating CI failures

`autoflow-ci.yml` has four producers — `fast-checks`, `source-matrix`, `packed-consumers`, `fresh-clone` — plus the aggregation job `autoflow-ci`. The aggregation runs with `if: always()` and asserts each producer result, so a failed or cancelled producer fails the required check explicitly: read the aggregation conclusion first, then open only the failing producer. `saas-optional` is `continue-on-error` by design and never gates the framework candidate.

## Commits

Use Conventional Commits with the prefixes actually in use: `fix`, `feat`, `docs`, `chore`, `refactor`, `test`, `ci`, `release`.

## Release work

Follow [the release operation](./docs/maintainers/releasing.md). Local passes never authorize publication; releases require the exact candidate SHA, green required CI, human review, independent verification, and explicit maintainer approval.
