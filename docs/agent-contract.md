---
status: active
topic: Agent and gate contract
summary: Canonical commands, generated surfaces, gate semantics and the diagnostics consumption contract.
---

# Agent Development Contract

What a coding agent may rely on when working in this repository. The
mechanically checkable facts here are checked by
`node tools/repo/check-agent-contract.ts` (the conformance test rides the
vitest `tools` project, so PR CI fails on drift): the workspace and gate tables
are rendered from `package.json` facts (never hand-copied), every command named
anywhere in the document must resolve against the real workspace/script graph,
and every internal gate step must name an existing package + task. A renamed or
deleted command turns the contract red.

The check is static conformance, not execution: it does not run the gates, and
it does not prove prose about side effects, trackedness, or CI wiring. Those
remain review facts. Change the contract in the same commit that changes the
behavior it describes, then regenerate the derived blocks
(`node tools/repo/check-agent-contract.ts --write`) and run the conformance
check.

Verified against the alpha.15 release tree (#1613); the tree's release stamp
is `1.0.0-alpha.15` (all six package manifests, `CREATE_VERSION`,
`release-state.json`'s `sourceVersion`, and the state machine's
`ADMITTED_ACTIVE_TARGET`). The registry serves `1.0.0-alpha.15` on both the
`alpha` and `latest` dist-tags, and the `v1.0.0-alpha.15` tag and GitHub
Release exist, so the source version and the published line are the same fact
on this release. The published
consumer index is [llms.txt](https://openelement.org/llms.txt).

## Repository entry points

There are three committed, public entry points for an agent:

- this contract (the maintainer/agent surface of the repository),
- the published consumer index [llms.txt](https://openelement.org/llms.txt),
- the `AGENTS.md` a generated application ships (the starter template), which
  points a user's agents at the index, the lifecycle commands, the layout and
  the server/client boundary rules.

The repository's current view is the generated
[docs/architecture/README.md](architecture/README.md) index: each governing
document carries its own `status:` / `topic:` / `summary:` front matter, and the
[archive and removal register](legacy/README.md) records documents that left the
tree. When two readings of the same topic appear to conflict, the generated
index says which document is in force.

A **root** `AGENTS.md` is deliberately not part of the committed tree.
Owner ruling 2026-10-20: the working copy's root file is environment-local
(session execution policy, excluded via the clone's `.git/info/exclude`) and
must not ship as product guidance; the #1613 scope's "AGENTS.md entry pointer"
is satisfied by the generated-project template above plus this contract and
`llms.txt`. The session execution policy that file carries is stated in tracked
form in [Session execution model](#session-execution-model-owner-ruling-2026-09-21);
restoring a root pointer would still be an owner decision and must not make the
local file a repository fact.

## The canonical task entry

All tasks enter through the vp CLI (owner ruling, 2026-10-03): package.json
scripts stay the single source of truth, pnpm stays the package manager, and
`vp run` is the one dispatch surface (`tools/repo/vp-dispatch.ts`).

- The executable package-qualified form is
  `vp run --no-cache --fail-if-no-match --filter <pkg> <task>`. `--filter`
  selects by the package's exact NAME — the `name` field in the package's
  `package.json`, never its directory path — and `--fail-if-no-match` turns a
  selector that matched nothing into a non-zero exit. `--no-cache` is part of
  the documented proof form: a gate or evidence command must run, not replay a
  cached accelerator entry.
- The `pkg#task` specifier form is not an executable selector. Under vp 1.0.0
  it exits 0 with no output when the package does not resolve, and
  `--fail-if-no-match` is inert on it because the flag belongs to `--filter`.
  `gate.ts` uses `pkg#task` as its INTERNAL step notation and rewrites each
  step to the fail-closed form above; that notation is legal only inside a
  `node tools/repo/gate.ts` step list, never in a `vp run` call.
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

`@openelement/protocol` declares no scripts by charter (zero-dependency
contracts plus small runtime utilities, including diagnostics parsing). The tools suites have no aggregate test
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
| One package's tests (canonical form) | `vp run --no-cache --fail-if-no-match --filter @openelement/element test` |
| Router tests | `vp run --no-cache --fail-if-no-match --filter @openelement/router test` |
| Compiler tests | `vp run --no-cache --fail-if-no-match --filter @openelement/compiler test` |
| UI / create / site tests | `vp run --no-cache --fail-if-no-match --filter @openelement/ui test` / `vp run --no-cache --fail-if-no-match --filter @openelement/create test` / `vp run --no-cache --fail-if-no-match --filter @openelement/www test` |
| Local full verification (check + test + gates) | `vp run verify` |
| Build the docs site into `www/dist` | `vp run site:build` |
| Site verification (links, tokens, content) | `vp run site:verify` |
| Full release precheck (local writes + network; not read-only) | `vp run release:check` |
| Content dates (read-only validation) | `vp run --no-cache --fail-if-no-match --filter @openelement/www check:content-dates` |
| Interface snapshot (check / write) | `vp run --no-cache --fail-if-no-match --filter @openelement/tools-repo interface:snapshot` / `vp run --no-cache --fail-if-no-match --filter @openelement/tools-repo interface:snapshot:write` |
| Doc figures (measured-output gate) | `vp run --no-cache --fail-if-no-match --filter @openelement/www check:doc-figures` |
| Version bump (one knob, twelve release-line points + four member stamps) | `pnpm --dir tools/repo run version-bump <version> [--write]` |
| Workflow lint (after any `.github` touch) | `zizmor --offline .` |
| This contract's own conformance check | `node tools/repo/check-agent-contract.ts` |

`release:check` runs generation, registry queries, release/build and packed gates,
then publish dry-run. It writes local artifacts and uses the network; do not run
it during a read-only audit. Dry-run is not publication, and this command is not
publication authorization. The derived gate table below records its actual steps;
command conformance alone does not validate prose about side effects.

## Generated files — never hand-edit

| Generated surface | Repository state | Written only by | Checked by |
| --- | --- | --- | --- |
| `www/app/data/_generated-*.ts` (guide/architecture/blog data, nav, article routes, changelog archive, content meta, page code, quickstart, API reference, error reference, error codes, install command) | **Git-ignored** (`.gitignore`: `www/app/data/_generated-*.ts`); a local build input, never committed | the `www` `generate:*` tasks, auto-enrolled in `vp run generate:all` | the paired `--check` tasks (byte-identical compare), wired into `gate:release` |
| `www/app/data/_generated-release-line.ts` | **Git-ignored** (same pattern) | the release train's registry read-back (internal release procedure, not published) | `@openelement/tools-release#registry-drift:check` (in `gate:release`) |
| `docs/release/public-interface-snapshot.json` | **Tracked** (committed) | `vp run --no-cache --fail-if-no-match --filter @openelement/tools-repo interface:snapshot:write` | `vp run --no-cache --fail-if-no-match --filter @openelement/tools-repo interface:snapshot` (in `gate:source` and CI) |
| `packages/ui/src/generated-manifest.json` | **Tracked** (committed) | `vp run --no-cache --fail-if-no-match --filter @openelement/ui generate:ui-manifest` | `@openelement/ui#ui-manifest:check` (in `gate:release`) |
| `packages/ui/custom-elements.json` | **Tracked** (committed) | `vp run --no-cache --fail-if-no-match --filter @openelement/ui generate:ui-cem` | `@openelement/ui#ui-cem:check` (in `gate:release`) |
| `www/dist/**` | **Git-ignored** (build output; `.gitignore`: `dist/`) | `vp run site:build` (redirects/sitemap/RSS emitters write into it) | the site build and consumer gates that read `dist` |

Trackedness changes what a bad edit looks like, not whether the file is
generated. Editing a **tracked** surface either makes a paired `--check` fail
with a byte diff (when that check runs before any regeneration) or, if no such
check runs, leaves a reviewable repository diff. Editing a **Git-ignored**
surface is overwritten by the next generator run and leaves no repository diff
at all. Never hand-edit either class.

Adding a `generate:*` script enrolls it in `generate:all` automatically; the
generator/emitter wiring rules live in `tools/repo/check-generator-gates.ts`.
That check verifies the wiring — a task that reruns the same script with
`--check` — and does **not** assert trackedness: a green `--check` is the
reproducibility evidence for the inputs, not proof that a tracked output was
committed. It also reports gate order rather than hiding it: `gate:release`
runs the two tracked outputs' checks — `@openelement/ui#ui-manifest:check` and
`@openelement/ui#ui-cem:check` — before `generate:all`, so their byte compare
sees the committed bytes; the Git-ignored `www` checks follow `generate:all`,
where regeneration is the only valid content. A paired check that follows
`generate:all` gets a note, so the remaining ordering limit is visible. Gate
ordering is owned by the release lane, not by this contract's check.

## Gate semantics

A gate is a fail-closed sequence: steps run serially through
`tools/repo/gate.ts`, the first failure stops the run, the process exits 1,
and a fully green run prints the step count. CI is the verdict, not the
debugger — reconcile locally before pushing.

The step column in the table below uses `gate.ts`'s internal `pkg#task`
notation. That notation is legal only inside a gate step list: `gate.ts`
validates each step (exact package NAME, no path selector) and dispatches it as
`vp run --no-cache --fail-if-no-match --filter <pkg> <task>`. It is not a
`vp run` invocation and must not be copied into one. This contract's check
validates every root and workspace gate step against the real package/task
graph; it does not execute the gate.

<!-- derived:gates:start -->
| Gate | Steps, in order (the first failure stops the gate) |
| --- | --- |
| `vp run check` | `fmt:check` → `lint` → `typecheck` → `@openelement/tools-repo#lint:markdown` → `@openelement/www#check:public-docs` |
| `vp run gate:release` | `@openelement/tools-repo#gate:release` → `@openelement/tools-release#gate:packed` |
| `vp run release:check` | `@openelement/ui#ui-manifest:check` → `@openelement/ui#ui-cem:check` → `@openelement/tools-repo#generate:all` → `@openelement/tools-repo#release:registry-check` → `@openelement/tools-repo#gate:release` → `@openelement/tools-release#gate:packed` → `@openelement/tools-release#publish:npm:dry-run` |
| `vp run saas:verify` | `@openelement/saas#check` → `@openelement/saas#test` |
| `vp run saas:workers` | `@openelement/saas#build` → `@openelement/saas#nitro:build-workers` → `@openelement/tools-repo#workers:boundary-check` |
| `vp run site:build` | `@openelement/tools-repo#generate:all` → `@openelement/www#build` → `@openelement/www#pagefind` → `@openelement/www#emit:redirects` → `@openelement/www#emit:sitemap` → `@openelement/www#emit:rss` |
| `vp run site:verify` | `site:build` → `@openelement/www#check:links` → `@openelement/www#check:theme-tokens` → `@openelement/www#check:content` → `@openelement/tools-repo#retired-api:check` |
| `vp run test:e2e` | `site:build` → `@openelement/www#e2e:browsers` → `@openelement/fixture-router-native-framework#e2e` |
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
- The tracked agent-facing entry is [CONTRIBUTING.md](../CONTRIBUTING.md)
  (the vp task doctrine and the gate architecture); this contract is its
  detailed, mechanically checked form. CONTRIBUTING.md is prose and is not
  machine-checked, so where the two differ on the executable vp form, this
  contract and its checkers are authoritative. `AGENTS.md`, where a checkout
  carries one, is an owner-local overlay, not a repository fact.

## Session execution model (owner ruling 2026-09-21)

The permanent division of labour for agent sessions in this repository: the
session model does planning, review and merge strategy only; implementation runs
on a cheap implementation model (deepseek-v4.1-flash or its successor) dispatched
as workflow subagents. This section is the tracked statement; a checkout's root
`AGENTS.md` is the owner-local overlay described in
[Repository entry points](#repository-entry-points), not a repository fact.

The planning side carries the obligations that make that split work:

- **Cross-lane conflict map first.** Before a multi-lane plan starts, map the
  shared files, generated-artifact dependencies and global invariants — the full
  reconciliation surface. A plan that cannot predict its merge conflicts is a
  planning failure, not a CI problem.
- **Consolidation PRs are the default merge strategy.** Every merge to the
  default branch stales the other PRs (the up-to-date rotation door); plan the
  consolidation instead of fighting it in CI.
- **Local reconciliation before CI.** Merge, generate, check, run the focused
  tests and review the full diff locally; CI is the verdict, not the debugger.
- **CI is the merge gate, not a substitute for review.** Required checks must be
  green on the exact head (see [CONTRIBUTING.md](../CONTRIBUTING.md)), and merge
  authorization stays a human owner decision.

Exceptions — a session implementing directly, or a different implementation
model — are an owner decision and are recorded in the pull request that relies on
them. `Signed-off-by` certifies DCO provenance, not which model implemented the
change; where the division of labour matters to the record, the pull request
description states it.

## Ritual checklist (learned the hard way)

| Ritual | Command | Rule |
| --- | --- | --- |
| Interface snapshot | `vp run --no-cache --fail-if-no-match --filter @openelement/tools-repo interface:snapshot:write` | Run whenever public exports change; the check rides every PR. |
| Content dates | `vp run --no-cache --fail-if-no-match --filter @openelement/www check:content-dates` | The manifest `www/lib/content-dates.json` is hand-edited inside the content commit itself; the check is read-only validation. |
| Doc figures | `vp run --no-cache --fail-if-no-match --filter @openelement/www check:doc-figures` | The measured-output numbers in the comparison docs must match a fresh `www/dist` measurement; re-baseline on >1% growth. |
| e2e outline pins | (www e2e specs) | Adding H2 sections to outline-pinned docs requires updating the pins; prefer not adding H2 sections. |
| Version bump | `pnpm --dir tools/repo run version-bump <version> [--write]` | One knob: twelve release-line points plus the four release-line-shaped workspace-member stamps — 16 files today (the dry run's `points:` line is authoritative); see the internal release procedure (not published). |
| Workflow lint | `zizmor --offline .` | Required after touching anything under `.github` — workflows AND composite actions. |
| Cross-system seams | (register + test) | A seam change registers in `docs/architecture/seams.md` AND ships a consumer-form test (constitution P8, ADR-0163); a seam missing either does not pass the gate. |
| Shim inventory | `vp run --no-cache --fail-if-no-match --filter @openelement/tools-repo shims:check` | `docs/architecture/shim-inventory.md` is a hand-maintained registry with a mechanical reader: every row carries an existing tracked path, an owner, a status, and a non-empty retirement condition. The reader rides `gate:source`. |
| Doc claims | `vp run --no-cache --fail-if-no-match --filter @openelement/www check:doc-claims` | Every machine-checkable factual claim in the covered docs (versions, commands, subpaths, gate and CI counts, ADR and path references, locale parity, the meta-description budget) must agree with the file that owns the fact. Narrative prose is explicitly out of scope; exemptions live in the checker's allowlist and each needs a reason. |
| ADR index | `vp run --no-cache --fail-if-no-match --filter @openelement/tools-repo adr-index:check` | A record must be listed, its links resolvable, and a non-active record annotated `SUPERSEDED` / `RETIRED` / `EXECUTED`; the reader rides `gate:source`. |
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
