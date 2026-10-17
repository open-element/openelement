# Agent Development Contract

What a coding agent may rely on when working in this repository. Every claim
here is checked mechanically by `node tools/repo/check-agent-contract.ts`
(the conformance test rides the vitest `tools` project, so PR CI fails on
drift): the command tables are derived from `package.json` facts, never
hand-copied, and a renamed or deleted command turns the contract red. Change
the contract in the same commit that changes the behavior it describes, then
regenerate the derived blocks (`node tools/repo/check-agent-contract.ts
--write`) and run the conformance check.

Verified against the `1.0.0-alpha.15` tree (#1613). The published consumer
index is [llms.txt](https://openelement.org/llms.txt).

## The canonical task entry

All tasks enter through the vp CLI (owner ruling, 2026-10-03): package.json
scripts stay the single source of truth, pnpm stays the package manager, and
`vp run` is the one dispatch surface (`tools/repo/vp-dispatch.ts`).

- `vp run --fail-if-no-match <pkg>#<task>` resolves by the package's exact NAME — the `name`
  field in the package's `package.json`, never its directory path. The
  path-shaped form (`dir#task`) silently no-ops under vp 1.0.0 (exit 0, no
  output), so package-qualified calls carry `--fail-if-no-match`, which
  turns a selector that matched nothing into a non-zero exit.
- A bare `vp run <task>` dispatches against the root workspace package
  (`fmt`, `check`, `test`, `site:build`, ...).
- Gate steps dispatch with `--no-cache` — a gate step is proof, not a build
  accelerator (`tools/repo/gate.ts`).
- Install first: `pnpm install --frozen-lockfile`. The `vp` shim resolves at
  `node_modules/.bin/vp`; a missing shim fails closed with that diagnosis.
- Discovery is canonical: the workspace list comes from
  `pnpm-workspace.yaml` and every task from its package's `scripts`
  (`tools/repo/workspace-tasks.ts`). Task names below are checked against
  those facts.

### Workspaces

<!-- derived:workspaces:start -->
| Package name | Workspace directory |
| --- | --- |
| `@openelement/compiler` | `packages/compiler` |
| `@openelement/create` | `packages/create` |
| `@openelement/e2e-starter-smoke` | `tests/e2e/starter-smoke` |
| `@openelement/element` | `packages/element` |
| `@openelement/fixture-router-base-path` | `tests/fixtures/router-base-path` |
| `@openelement/fixture-router-lit-framework` | `tests/fixtures/router-lit-framework` |
| `@openelement/fixture-router-native-framework` | `tests/fixtures/router-native-framework` |
| `@openelement/fixture-router-nitro` | `tests/fixtures/router-nitro` |
| `@openelement/fixture-router-request-time` | `tests/fixtures/router-request-time` |
| `@openelement/fixture-router-static-only` | `tests/fixtures/router-static-only` |
| `@openelement/fixture-router-ui-dogfood` | `tests/fixtures/router-ui-dogfood` |
| `@openelement/fixture-router-unocss-probe` | `tests/fixtures/router-unocss-probe` |
| `@openelement/fixture-site-light-probe` | `tests/fixtures/site-light-probe` |
| `@openelement/fixture-third-party-web-components` | `tests/fixtures/third-party-web-components` |
| `@openelement/fixture-web-component-interop` | `tests/fixtures/web-component-interop` |
| `@openelement/protocol` | `packages/protocol` |
| `@openelement/router` | `packages/router` |
| `@openelement/saas` | `apps/saas` |
| `@openelement/tools-release` | `tools/release` |
| `@openelement/tools-repo` | `tools/repo` |
| `@openelement/ui` | `packages/ui` |
| `@openelement/www` | `www` |
<!-- derived:workspaces:end -->

`@openelement/protocol` declares no scripts by charter (a types-only
contract with zero dependencies). The tools suites have no aggregate test
task by design: the repo vitest `tools` project (`vitest.config.ts`) owns
`tools/repo`, `tools/lib` and `tools/release`, and CI runs it with
`vitest run --project tools`.

### The commands agents actually run

| Purpose | Command |
| --- | --- |
| Format (write) | `vp run fmt` |
| The pre-push check: fmt + lint + typecheck + markdown | `vp run check` |
| Regenerate every derived artifact | `vp run generate:all` |
| The full workspace test suite | `vp run test` |
| One package's tests (canonical form) | `vp run --fail-if-no-match @openelement/element#test` |
| Router tests | `vp run --fail-if-no-match @openelement/router#test` |
| Compiler tests | `vp run --fail-if-no-match @openelement/compiler#test` |
| UI / create / site tests | `vp run --fail-if-no-match @openelement/ui#test` / `vp run --fail-if-no-match @openelement/create#test` / `vp run --fail-if-no-match @openelement/www#test` |
| Local full verification (check + test + gates) | `vp run verify` |
| Build the docs site into `www/dist` | `vp run site:build` |
| Site verification (links, tokens, content) | `vp run site:verify` |
| Release precheck (read-only registry queries) | `vp run release:check` |
| Content dates (read-only validation) | `vp run --fail-if-no-match @openelement/www#check:content-dates` |
| Interface snapshot (check / write) | `vp run --fail-if-no-match @openelement/tools-repo#interface:snapshot` / `vp run --fail-if-no-match @openelement/tools-repo#interface:snapshot:write` |
| Doc figures (measured-output gate) | `vp run --fail-if-no-match @openelement/www#check:doc-figures` |
| Version bump (one knob, ten stamp sites) | `pnpm --dir tools/repo run version-bump <version> [--write]` |
| Workflow lint (after any `.github` touch) | `zizmor --offline .` |
| This contract's own conformance check | `node tools/repo/check-agent-contract.ts` |

## Generated files — never hand-edit

| Generated surface | Written only by | Checked by |
| --- | --- | --- |
| `www/app/data/_generated-*.ts` (blog data, nav, article routes, API reference, error reference, error codes, install command) | the `www` `generate:*` tasks, auto-enrolled in `vp run generate:all` | the paired `--check` tasks (byte-identical compare), wired into `gate:release` |
| `www/app/data/_generated-release-line.ts` | the release train's registry read-back (see `docs/maintainers/releasing.md`) | `@openelement/tools-release#registry-drift:check` (in `gate:release`) |
| `docs/release/public-interface-snapshot.json` | `vp run --fail-if-no-match @openelement/tools-repo#interface:snapshot:write` | `vp run --fail-if-no-match @openelement/tools-repo#interface:snapshot` (in `gate:source` and CI) |
| `packages/ui/src/generated-manifest.json` | `vp run --fail-if-no-match @openelement/ui#generate:ui-manifest` | `@openelement/ui#ui-manifest:check` (in `gate:release`) |
| `www/dist/**` | `vp run site:build` (redirects/sitemap/RSS emitters write into it) | the site build and consumer gates that read `dist` |

Hand-editing a generated file is wasted work — the next generator run
overwrites it and the paired `--check` task goes red. Adding a
`generate:*` script enrolls it in `generate:all` automatically; the
generator/emitter wiring rules live in `tools/repo/check-generator-gates.ts`.

## Gate semantics

A gate is a fail-closed sequence: steps run serially through
`tools/repo/gate.ts`, the first failure stops the run, the process exits 1,
and a fully green run prints the step count. CI is the verdict, not the
debugger — reconcile locally before pushing.

<!-- derived:gates:start -->
| Gate | Steps, in order (the first failure stops the gate) |
| --- | --- |
| `vp run check` | `fmt:check` → `lint` → `typecheck` → `@openelement/tools-repo#lint:markdown` |
| `vp run gate:release` | `@openelement/tools-repo#gate:release` → `@openelement/tools-release#gate:packed` |
| `vp run release:check` | `@openelement/tools-repo#generate:all` → `@openelement/tools-repo#release:registry-check` → `@openelement/tools-repo#gate:release` → `@openelement/tools-release#gate:packed` → `@openelement/tools-release#publish:npm:dry-run` |
| `vp run saas:verify` | `@openelement/saas#check` → `@openelement/saas#test` |
| `vp run saas:workers` | `@openelement/saas#build` → `@openelement/saas#nitro:build-workers` → `@openelement/tools-repo#workers:boundary-check` |
| `vp run site:build` | `@openelement/tools-repo#generate:all` → `@openelement/www#build` → `@openelement/www#pagefind` → `@openelement/www#emit:redirects` → `@openelement/www#emit:sitemap` → `@openelement/www#emit:rss` |
| `vp run site:verify` | `site:build` → `@openelement/www#check:links` → `@openelement/www#check:theme-tokens` → `@openelement/www#check:content` → `@openelement/tools-repo#retired-api:check` |
| `vp run test:e2e` | `site:build` → `@openelement/www#e2e:browsers` → `@openelement/fixture-router-native-framework#e2e` → `@openelement/fixture-router-lit-framework#e2e` |
| `vp run verify` | `check` → `test` → `@openelement/tools-repo#gate:source` → `saas:verify` → `saas:workers` → `@openelement/tools-release#gate:packed` |
| `vp run verify:core` | `@openelement/tools-repo#gate:source` → `@openelement/tools-release#gate:packed` |
<!-- derived:gates:end -->

Layers, not just lists:

- **PR layer** (`.github/workflows/autoflow-ci.yml`): fast checks
  (`vp run check`), `vp run generate:all`, the interface snapshot,
  governance boundaries, every package's tests (element, router, compiler,
  ui, create, www, the tools project), the chromium browser gate, the site
  build + e2e, and pack + packed-consumer verification.
- **Release train** (`autoflow-release.yml`): the long gates
  (`@openelement/tools-repo#gate:release`), the publish path, and the
  post-publish consumer qualification.
- **Local hooks** (`.githooks/`, installed by the repo `prepare` script):
  pre-commit runs format + lint; pre-push runs format, lint, markdown lint,
  typecheck, the release dependency-graph check, the pack-surface check and
  the export-files check. The hooks are a courtesy — the gates above are the
  contract.

## Reading build failures: the diagnostics envelope (#1612)

One machine-readable JSON shape answers every build failure; it is owned by
`@openelement/protocol` (the `./diagnostics` subpath) and produced by every
coded failure surface.

- One diagnostic is a `DiagnosticEnvelope`: `code` (the producer's stable
  code — `OEC####` compiler diagnostics, `OE_SSG_*`, `OE_PRESET_*`),
  `severity` (`error` fails the build), `phase`, `message`, and when known
  `file` + 1-based `line`/`column` and a `hint`.
- The aggregate is a `DiagnosticReport`: `format` is the literal
  `openelement.diagnostics/1`, `ok` derives from the diagnostics (one
  `error` severity is enough to fail it), and `diagnostics` is the array.
- The build CLI carries it beside the unchanged human output:
  `openelement build --diagnostics=json` writes one JSON report line on
  stderr, and `openelement build --diagnostics-file=<path>` writes the same
  document to a file. A build with no diagnostics writes nothing on either
  channel; the flags never change the verdict or the exit code.
- Consumers parse with `parseDiagnosticReport` from
  `@openelement/protocol/diagnostics`. It fails closed: truncated JSON, a
  foreign format tag, or a structurally broken diagnostic raises
  `DiagnosticReportParseError` — never a half-valid report. Unknown codes
  and unknown fields round-trip untouched (forward compatibility). Read the
  FILE (or the stderr JSON line); never grep human log output.
- Producers map their already-structured records INTO the envelope
  (`compilerDiagnosticsToEnvelopes` in the compiler, the admission scan's
  coded warnings, `errorToEnvelope` for the `OpenElementError` dialect); the
  codes stay owned by their producers. The `/errors` page on the docs site
  is generated from those same code registries — a code in the source cannot
  be missing from the page.

## Branch and PR conventions

- PRs are English, technical only. Description carries the motivation, the
  acceptance evidence (commands + output summaries), and the ledger/issue
  references where applicable.
- Consolidation PR is the default merge strategy; every merge to the default
  branch stales the others (the up-to-date rotation door) — plan for it
  instead of fighting it in CI.
- CI green is necessary, not sufficient: merge authorization is a human
  owner decision per PR.
- CodeQL findings need their thread resolved before merge.
- The tracked agent-facing entry is [CONTRIBUTING.md](../../CONTRIBUTING.md)
  (the vp task doctrine and the gate architecture); this contract is its
  detailed, mechanically checked form. `AGENTS.md`, where a checkout carries
  one, is an owner-local overlay, not a repository fact.

## Ritual checklist (learned the hard way)

| Ritual | Command | Rule |
| --- | --- | --- |
| Interface snapshot | `vp run --fail-if-no-match @openelement/tools-repo#interface:snapshot:write` | Run whenever public exports change; the check rides every PR. |
| Content dates | `vp run --fail-if-no-match @openelement/www#check:content-dates` | The manifest `www/lib/content-dates.json` is hand-edited inside the content commit itself; the check is read-only validation. |
| Doc figures | `vp run --fail-if-no-match @openelement/www#check:doc-figures` | The measured-output numbers in the comparison docs must match a fresh `www/dist` measurement; re-baseline on >1% growth. |
| e2e outline pins | (www e2e specs) | Adding H2 sections to outline-pinned docs requires updating the pins; prefer not adding H2 sections. |
| Version bump | `pnpm --dir tools/repo run version-bump <version> [--write]` | One knob, ten stamp sites; see `docs/maintainers/version-bump.md`. |
| Workflow lint | `zizmor --offline .` | Required after touching anything under `.github` — workflows AND composite actions. |
| Cross-system seams | (register + test) | A seam change registers in `docs/architecture/seams.md` AND ships a consumer-form test (constitution P8, ADR-0163); a seam missing either does not pass the gate. |
| Publish dispatch | (GitHub Actions) | Requires main push CI green FIRST — the exact-SHA contract. |

## Maintaining this contract

- The `derived:*` blocks regenerate mechanically:
  `node tools/repo/check-agent-contract.ts --write`. A hand edit to them
  fails the conformance check.
- Every command in this document is a claim: when you rename or delete a
  task, the conformance test fails until the contract says the new truth.
- The published consumer index is `www/public/llms.txt`, served at
  [https://openelement.org/llms.txt](https://openelement.org/llms.txt) by the
  site build (Vite copies `public/` to the site root). Keep it pointing at
  surfaces that exist — the conformance check validates its links.
