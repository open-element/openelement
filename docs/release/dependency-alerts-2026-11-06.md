# Dependency security triage — 2026-11-06 (12 open Dependabot alerts)

Date: 2026-11-06. Baseline: `origin/main` = `4f9821527e2893dc232635b65e57be75649efc37`.
Scope: the 12 open Dependabot alerts on `open-element/openelement` at that
commit (5 high / 5 medium / 2 low). This record is a read-only triage: it reads
the GitHub alert API and the pnpm lockfile, records a reachability judgement and
a disposition per alert, and changes no dependency, no lockfile and no CI. It is
the C5 disposition record, not an upgrade plan.

## Method and sources

- **Alerts.** `gh api 'repos/open-element/openelement/dependabot/alerts?state=open&per_page=100'`
  (read-only), fetched on 2026-11-06 with the workspace at `4f9821527`. All 12
  alerts share `dependency.manifest_path: pnpm-lock.yaml` and were created by the
  same advisory sync on 2026-11-06 06:33Z; severity, GHSA id, vulnerable range and
  first patched version below are GitHub's own values.
- **Dependency graph.** Read from `pnpm-lock.yaml` (lockfile v9: `importers` +
  `snapshots`) at the baseline, then traced from each vulnerable package up to
  the workspace importer(s) that resolve it; source-import reachability was
  checked by searching the source tree (ripgrep over `packages/`, `apps/`, `www/`
  and `tools/`). The lockfile is the single npm manifest; the workspace has no
  `pnpm.overrides`.
- **What "scope" means here.** GitHub's `scope` field is the manifest section
  the dependency is declared in (`runtime` = a `dependencies` section,
  `development` = a `devDependencies` section); it is not a reachability
  verdict. Reachability is judged below from the importer chain and from which
  code actually imports the package.
- **Dependabot cover.** `.github/dependabot.yml` configures only
  `github-actions` (weekly, cooldown, no auto-merge). Its header comment states
  that Dependabot does not support the pnpm workspace lockfile and that
  dependency update PRs are human-authored and run the full CI gate. npm
  dependencies are therefore not covered by Dependabot updates: this file is the
  human-reviewed npm side.
- **Supply-chain guard stays on.** `pnpm-workspace.yaml` keeps
  `minimumReleaseAge: 4320` (three days) as the resolution guard, and postinstall
  builds stay allowlisted; nothing here relaxes either.

## 1. The 12 alerts

| # | Package | Severity | GHSA | Manifest | Declared scope | Vulnerable range | First patched |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 45 | `minimatch` | medium | GHSA-g3hv-75wg-m249 | `pnpm-lock.yaml` | runtime | `>= 7.0.0, < 11.0.1` | 11.0.1 |
| 44 | `@hono/node-server` | medium | GHSA-rmxm-3fg6-px4f | `pnpm-lock.yaml` | runtime | `>= 1.19.10, < 2.1.3` | 2.1.3 |
| 43 | `zod` | **high** | GHSA-mrhx-c7xc-m3w5 | `pnpm-lock.yaml` | runtime | `< 4.6.6` | 4.6.6 |
| 42 | `markdown-it` | **high** | GHSA-gfr2-rv44-r23c | `pnpm-lock.yaml` | development | `>= 14.1.0, < 14.3.3` | 14.3.3 |
| 41 | `markdown-it` | low | GHSA-vfgh-jcmw-g37q | `pnpm-lock.yaml` | development | `< 14.3.3` | 14.3.3 |
| 40 | `markdown-it` | **high** | GHSA-r7fv-28h4-cvq7 | `pnpm-lock.yaml` | development | `< 14.3.2` | 14.3.2 |
| 39 | `smol-toml` | medium | GHSA-r4xh-jqrq-34v2 | `pnpm-lock.yaml` | development | `<= 1.8.0` | 1.9.0 |
| 38 | `katex` | low | GHSA-238p-pmpm-9mq7 | `pnpm-lock.yaml` | development | `>= 0.11.0, < 0.18.2` | 0.18.2 |
| 37 | `source-map-js` | **high** | GHSA-68fv-2mgg-jv7q | `pnpm-lock.yaml` | development | `>= 1.0.0, < 1.2.2` | 1.2.2 |
| 36 | `markdown-it` | medium | GHSA-253c-mchw-3w2r | `pnpm-lock.yaml` | development | `< 14.3.1` | 14.3.1 |
| 35 | `js-yaml` | medium | GHSA-r3ph-w7gj-g6xm | `pnpm-lock.yaml` | development | `>= 5.0.0, <= 5.4.0` | 5.4.1 |
| 34 | `smol-toml` | **high** | GHSA-7w5x-hrqm-74c2 | `pnpm-lock.yaml` | development | `<= 1.7.0` | 1.7.1 |

Resolved instances in `pnpm-lock.yaml` at the baseline (one alert can cover more
than one instance):

| Package | Instances present | Instance verdict |
| --- | --- | --- |
| `minimatch` | `9.0.9` | vulnerable (whole 9.x line is below the patched 11.0.1) |
| `@hono/node-server` | `1.19.17`, `2.1.1` | both vulnerable (patched 2.1.3) |
| `zod` | `3.25.76`, `4.6.5` | both vulnerable (patched 4.6.6) |
| `markdown-it` | `14.3.0` | vulnerable under all four advisories |
| `smol-toml` | `1.7.0` | vulnerable under both advisories |
| `katex` | `0.16.47` | vulnerable (patched 0.18.2) |
| `source-map-js` | `1.2.1` (vulnerable), `1.2.2` (patched) | both copies are in the lockfile; see §2.2 |
| `js-yaml` | `5.2.2` (vulnerable), `3.15.2` (outside this advisory's range) | only the 5.x copy is in range |

## 2. Reachability — how each chain is reached

No alert reaches the browser runtime bundle. The two published runtime packages
have no path to any of these packages: `@openelement/element` depends only on
`@openelement/protocol` (`packages/element/package.json`), and protocol declares
zero dependencies. The chains below are build-time, dev-server, devtools or
test-only surfaces.

### 2.1 Lint/docs tooling — `markdownlint-cli2` (dev-only)

`markdown-it@14.3.0`, `smol-toml@1.7.0`, `js-yaml@5.2.2` and `katex@0.16.47` are
all children of `markdownlint-cli2@0.23.2`, which is a `devDependencies` entry
of the root workspace and of `tools/repo`:

- `markdown-it` and `smol-toml` are direct dependencies of
  `markdownlint-cli2@0.23.2`;
- `katex` arrives through `markdownlint-cli2 → markdownlint@0.41.1 →
  micromark-extension-math@3.1.0 → katex@0.16.47`;
- `js-yaml@5.2.2` is a direct dependency of `markdownlint-cli2@0.23.2`
  (`js-yaml@3.15.2` separately arrives through `gray-matter` in the private
  `www` app and is outside advisory #35's `>= 5.0.0` range).

Exposure: the markdown gate only; run locally and in the `lint` CI job against
this repository's own markdown. No untrusted document is parsed, and none of
these packages is part of a published artifact or the shipped runtime. The four
`markdown-it` advisories are quadratic/DoS classes, not code execution.

### 2.2 Build toolchain — `source-map-js` (build-time only)

`source-map-js@1.2.1` is reached through build tooling, from several parents:
`postcss@8.5.28` (a direct dependency of `packages/router`, and the copy
`vite@8.1.6` resolves; the same chain reaches `packages/compiler`,
`apps/saas`, `www` and the fixtures), `@tailwindcss/node@4.3.3`,
`css-tree@3.2.1` (unocss transformer), and `magicast@0.5.5` (via
`@vitest/coverage-v8`).

A patched copy already exists in the same lockfile: `source-map-js@1.2.2` is
resolved under `postcss@8.5.31`, which is a dependency of
`@voidzero-dev/vite-plus-core@1.4.0` (the `vp` tooling), not of the product build
chain. The advisory is an event-loop DoS through indexed source-map section
offsets — it needs a hostile source map to be parsed, and this repository
parses its own build output, not third-party source maps. Exposure: build and
test tooling; not runtime.

### 2.3 Dev server — `@hono/vite-dev-server` (local dev only)

`minimatch@9.0.9` and `@hono/node-server@1.19.17` are dependencies of
`@hono/vite-dev-server@0.25.3`, which `packages/router` resolves:

- the package is loaded lazily and only for the Vite dev server: the router's
  `packages/router/src/vite/dev-server.ts` header documents it as an optional
  peer that is loaded on the first dev-server hook, with `apply: 'serve'`, so
  `build`, `start` and Route Mode never import it (the peer-resolution failure
  mode is covered by the router's dev-server peer tests);
- the router manifest resolves it under `dependencies` so the workspace install
  has it, but the module is only imported in serve mode;
- the vulnerable `serveStatic` API of `@hono/node-server` is not called by
  repository code. `@hono/node-server` is imported only in private fixture e2e
  servers (`tests/fixtures/router-{lit,native,ui-dogfood,request-time}/e2e/server.ts`,
  `serve` only), and the repo's own static test server is
  `tools/lib/static-server.ts`, which does not use the package.

Exposure: a developer running `oe dev` from a checkout/starter. The defeat is a
path-decoding bypass in dev-server middleware over local files; it is not a
shipped-runtime or production-server surface. The four fixture pins are also
vulnerable (`2.1.1`), test-only.

### 2.4 Devtools stack — `zod` (tooling-only)

`zod@4.6.5` arrives through the `unocss@66.10.0` devtools chain
(`unocss → @unocss/inspector → @vitejs/devtools-kit → @devframes/json-render →
@json-render/core`, plus the `@modelcontextprotocol/server` packages under
`devframe`). `unocss` is an optional peer of the router resolved for the
workspace (and probed in `tests/fixtures/router-unocss-probe`); its inspector and
devtools UI are development tooling, not part of the element browser runtime.

`zod@3.25.76` is a direct `dependencies` entry of the private
`tests/fixtures/router-request-time` fixture. Advisory #43 covers every version
below 4.6.6, so it covers both instances; there is no patched 3.x line.

### 2.5 Test fixtures (private, never published)

`@hono/node-server@2.1.1` is a direct dependency of four private router
fixtures (`router-lit-framework`, `router-native-framework`, `router-request-time`,
`router-ui-dogfood`); `zod@3.25.76` is the direct fixture pin above. All five
fixtures are `private: true` workspace members and are never packed or
published.

## 3. Disposition

Disposition class for all 12: **accept for this iteration, fix by moving the
dependency resolution** — no lockfile-level override, no forced resolution, no
auto-merge, and no dependency change in this change set. The reason is the same
for every row: none is reachable from a shipped runtime, and each fix is a normal
resolution change — a parent release where the parent pins exact versions or a
major outside its declared range, or a lockfile refresh where the patched version
is already inside the declared range. Each fix lands as a human-authored
dependency update PR that runs the full CI gate.

| Alerts | Disposition | Follow-up action |
| --- | --- | --- |
| #42, #41, #40, #36 (`markdown-it`), #39, #34 (`smol-toml`), #38 (`katex`), #35 (`js-yaml`) | Dev-only lint tooling; accept until `markdownlint-cli2` (and its `markdownlint` dependency) moves. `markdownlint-cli2@0.23.2` declares exact versions (`markdown-it 14.3.0`, `smol-toml 1.7.0`, `js-yaml 5.2.2`), and `micromark-extension-math@3.1.0` declares `katex ^0.16.0`, so the patched versions are outside the current parent resolutions. | Bump `markdownlint-cli2` when a release resolving `markdown-it ≥ 14.3.3`, `smol-toml ≥ 1.9.0`, `js-yaml ≥ 5.4.1` and `katex ≥ 0.18.2` (via `markdownlint`) is available; run the markdown gate and full CI in the same PR. |
| #37 (`source-map-js`) | Build-time tooling; accept. `postcss` declares `source-map-js ^1.2.1`, so a resolution refresh can take the patched `1.2.2`; the lockfile's vulnerable copy is only the resolved `1.2.1` under the current parents. | Resolve `source-map-js ≥ 1.2.2` for the build chain (a lockfile refresh, or the next `vite` 8.x / `postcss` / `@tailwindcss/vite` / unocss update); verify no vulnerable `source-map-js` copy remains in `pnpm-lock.yaml` before closing. |
| #44 (`@hono/node-server`) + #45 (`minimatch`) | Dev-server tooling; accept while `@hono/vite-dev-server` is the router's lazy optional peer. The parent declares `@hono/node-server ^1.19.11` and `minimatch ^9.0.3`, so the patched versions are new majors and the parent must move first. | Track an `@hono/vite-dev-server` release that accepts `@hono/node-server ≥ 2.1.3` and `minimatch ≥ 11.0.1`; when it lands, update the router peer range and the starter pin (`DEV_SERVER_STARTER_PIN` in `packages/create/src/version.ts`) in the same change. Separately, move the four fixture pins `@hono/node-server 2.1.1 → 2.1.3` at the next fixture refresh. |
| #43 (`zod`) | Devtools stack + test fixture; accept. The `zod@4.6.5` chain is range-compatible with the patch (`@json-render/core` declares `^4.3.6`, `@devframes/json-render` `^4.6.5`), so a refresh can take `4.6.6`. The fixture pin `zod ^3.25` has no patched 3.x (the advisory's first patched version is 4.6.6). | Take `zod ≥ 4.6.6` in the next lockfile refresh / unocss tooling update for the devtools chain; migrate the `router-request-time` fixture to `zod 4` when its schema usage is next touched, rather than forcing a cross-major resolution. |

Triage summary (all 12): **5 high** — #43, #42, #40, #37, #34: all dispositioned
above as accepted with a named parent update; none is reachable from the shipped
browser runtime. **5 medium** — #45, #44, #39, #36, #35: same class. **2 low** —
#41, #38: same class.

## 4. Manual npm dependency-update cadence

Dependabot's coverage gap is permanent for this repository shape, so the npm
side needs a human cadence:

1. **Each release-train window (at least monthly):** run the read-only open-alert
   sweep (`gh api 'repos/open-element/openelement/dependabot/alerts?state=open&per_page=100'`)
   and refresh this file's tables; any newly opened alert gets a disposition row
   before the next release candidate.
2. **One dependency-update PR per group, not per alert:** a group is a shared
   parent (for example the lint tooling group or the build-toolchain group);
   the PR records the alerts it closes, runs the full CI gate, and does not mix
   product changes.
3. **High severity:** disposition within the current iteration — either the
   parent bump lands or the row states why the exposure is not reachable.
4. **Closing an alert:** only after the patched version is in
   `pnpm-lock.yaml` on `main` and GitHub's next scan closes it, or after an
   owner-approved dismissal that cites this record. Do not dismiss an alert with
   "no fix available" while the table above names a patched version.
5. **No auto-merge, no overrides:** the workspace keeps its
   `minimumReleaseAge: 4320` guard and resolves updates through normal
   caret/exact ranges and parent releases.

## 5. Limits of this record

- Reachability is a static lockfile + import-site judgement. No exploitability
  test was run, no CVSS was re-derived, and the alert severity is GitHub's own.
- The fixture pins and the `unocss` peer resolution may change with the next
  fixture refresh; re-run the sweep after such a change.
- This file records disposition only. It does not upgrade anything, does not
  edit `pnpm-lock.yaml`, and is not a qualification or release evidence item.
