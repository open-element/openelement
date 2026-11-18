---
status: active
topic: M10-P1 applicability and capture coverage
summary: Which workspace apps produce a production browser entry, whether CI reaches them, and what the P1 checker actually reports for each; records the installed-consumer capture defect and the apps that remain undecidable.
---

# M10 P1 — applicability record

Measurement record for the M10 P1 predicate: *no production browser entry loads
the generic executor or the old protocol*. The checker
(`tools/repo/check-browser-entry-graph.ts`) judges only the artifacts it is
handed; the APPLICABLE APP LIST below is a claim of this record, not of the tool.

- Branch: `work/a16-lane-g`
- Tree: `f88aea0faa98c6250c158174e382699bdcb6a28d` (dirty only with build outputs; `git status --porcelain` is empty — every artifact below is under a Git-ignored `dist/`)
- Toolchain: Node v24.18.0, pnpm 12.8.1, vite-plus 1.4.0, vite 8.1.6
- Date: 2026-11-18
- All commands run from the repository root of `<repo>`

## What counts as a "production browser entry"

`packages/router/src/cli/build.ts:31` is the one build entry (`buildApp()` from
`packages/router/src/vite/index.ts`). Phase 2 of that build
(`packages/router/src/vite/build.ts:38-48`) calls
`buildClient()` (`packages/router/src/cli/build-client.ts:416`), which emits the
browser client bundle into `<outDir>/client` (`build-client.ts:778`) and mounts
the report-only observer that writes the artifact
(`build-client.ts:1148-1163`; writer
`packages/router/src/vite/internal/browser-entry-graph.ts:493`). The artifact
path is fixed by
`BROWSER_ENTRY_GRAPH_ARTIFACT_FILE = '.vite/oe-browser-entry-graph.json'`
(`packages/router/src/vite/internal/browser-entry-graph-artifact.ts:82`), i.e.
`<app>/<outDir>/client/.vite/oe-browser-entry-graph.json`.

`outDir` defaults to `dist` (`packages/router/src/vite/build-context.ts:125`,
`DEFAULT_OUT_DIR = 'dist'` at
`packages/router/src/vite/internal/paths.ts:9`) and is overridable only through
`openElement({ build: { outDir } })` (`build-context.ts:323`). **No workspace
app overrides it** — every `apps/*`, `www`, and `tests/fixtures/*`
`vite.config.ts` / `openelement.config.ts` was checked; none carries an
`outDir` key.

Three critical qualifications that the entry definition carries:

1. `buildClient()` is **not** reached for every app. Two shortcut paths remove
   the client directory outright and return `null`: "No islands found"
   (`build-client.ts:563-565`) and "No admitted reachable islands"
   (`build-client.ts:617-619`), both calling `removeClientDeliveryArtifacts`
   (`build-client.ts:397-402`), which `rm -rf`s `<outDir>/client`.
2. Even when the client bundle is built, an island-free entry takes the
   **style-only** path (`build-client.ts:654-655`), which deletes
   `<outDir>/client/islands` (`build-client.ts:1377`) and, when no style asset
   was emitted, removes the whole client directory
   (`build-client.ts:1389`). In the style-only case the observer **does** still
   run and writes an artifact — but the entry chunk it names (`islands/client.js`)
   no longer exists on disk afterwards.
3. The observer is **report-only**. A capture it cannot complete writes
   `{ status: "incomplete", reason }`, which the checker maps to `UNPROVEN`
   (exit 2), never `MET`.

## Part 1 — applicable app list

Workspace membership from `pnpm-workspace.yaml:6-10`
(`packages/*`, `apps/*`, `www`, `tools/*`, `tests/fixtures/*`,
`tests/e2e/starter-smoke`); confirmed against `pnpm ls -r --depth -1` (21
members). Only members that invoke `packages/router/src/cli/build.ts` produce a
browser entry; `packages/*` and `tools/*` build with `tsc --noEmit` only.

| app (package name) | generates a browser entry? | evidence (file:line of the build entry / its outDir) | reachable in CI? |
| --- | --- | --- | --- |
| `@openelement/www` | yes — production entry (`dist/client/islands/client.js`) | build: `www/package.json:11` → `packages/router/src/cli/build.ts`; plugin: `www/vite.config.ts:39` `openElement()`; outDir default `dist` (no override; `www/openelement.config.ts:85` sets only `manifestBudget`) | yes — `autoflow-ci.yml:359` and `:483` (`vp run site:build`, which runs `generate:all` first), plus the release train (`gate:release` → `site:build`) |
| `@openelement/saas` | yes — production entry (`apps/saas/dist/client/islands/client.js`) | build: `apps/saas/package.json:7` → `packages/router/src/cli/build.ts`; plugin: `apps/saas/vite.config.ts:19-20`; outDir default `dist` | **no** — no workflow in `.github/workflows/*.yml` invokes it. `apps/saas` appears in `.github/CODEOWNERS:19` only. Reachable only via the *local* root scripts `saas:workers` / `verify` (`package.json:15`, `:30`), which CI never runs |
| `@openelement/fixture-router-base-path` | yes — but a **style-only** entry; the emitted `islands/client.js` is deleted after the build | build: `tests/fixtures/router-base-path/package.json:7`; plugin: `tests/fixtures/router-base-path/vite.config.ts:28`; outDir default `dist` | yes — `autoflow-ci.yml:513` (`gate`), and the release train (`@openelement/fixture-router-base-path#gate`) |
| `@openelement/fixture-router-native-framework` | yes | build: `tests/fixtures/router-native-framework/package.json:7`; plugin: `tests/fixtures/router-native-framework/vite.config.ts:24`; outDir default `dist` | yes — `autoflow-ci.yml:497` (`gate`), and the release train |
| `@openelement/fixture-router-request-time` | yes (some request-time routes; the build also emits a client bundle) | build: `tests/fixtures/router-request-time/package.json:7`; plugin: `tests/fixtures/router-request-time/vite.config.ts:22`; outDir default `dist` | yes — `autoflow-ci.yml:514` (`gate`), and the release train |
| `@openelement/fixture-router-request-time/generated-only` (dir-nested, **not** a workspace member — no `pnpm-workspace.yaml` entry; `package.json` has no scripts) | yes — its own `dist/client/islands/client.js` | built directly: `node ../../../../packages/router/src/cli/build.ts` from inside the dir (documented in `tests/fixtures/router-request-time/generated-only/README.md:11-16`); plugin: `tests/fixtures/router-request-time/generated-only/vite.config.ts:12`; outDir default `dist` | **no** — "not part of any gate" per its own README; no workflow references it |
| `@openelement/fixture-router-static-only` | **no** — builds, but emits no client directory at all | build: `tests/fixtures/router-static-only/package.json:7`; plugin: `tests/fixtures/router-static-only/vite.config.ts:19`; outDir default `dist`; the client build hits `build-client.ts:1387-1391` ("No server-rendered style edges - zero client JS output") and `removeClientDeliveryArtifacts` (`build-client.ts:397-402`) deletes `dist/client` | yes — `autoflow-ci.yml:499` (`gate`), and the release train |
| `@openelement/fixture-router-ui-dogfood` | yes | build: `tests/fixtures/router-ui-dogfood/package.json:7`; plugin: `tests/fixtures/router-ui-dogfood/vite.config.ts:36`; outDir default `dist` | yes — `autoflow-ci.yml:498` (`gate`), and the release train |
| `@openelement/fixture-router-unocss-probe` | yes | build: `tests/fixtures/router-unocss-probe/package.json:7`; plugin: `tests/fixtures/router-unocss-probe/openelement.config.ts` (via bare `openElement()` in `vite.config.ts`); outDir default `dist` | yes — `autoflow-ci.yml:504` (`gate`), and the release train |
| `@openelement/fixture-site-light-probe` | yes | build: `tests/fixtures/site-light-probe/package.json:7`; plugin: `tests/fixtures/site-light-probe/vite.config.ts:25`; outDir default `dist` | yes — `autoflow-ci.yml:372` (build + e2e), and the release train (`#gate`) |
| `@openelement/e2e-starter-smoke` (scaffolded `my-blog`) | yes — the shipped-template production entry | `tests/e2e/starter-smoke/setup.ts:377` (`pnpm run build` in the scaffold) and `quality.ts:209`; the scaffold's `build` script is `oe build` (`packages/create/templates/package.json.tmpl:8`) → same `build.ts`; outDir default `dist` **outside** the repo (`mkdtemp` root) | yes — `autoflow-ci.yml:430` (`quality`, after `setup`) inside the pack job; also `published-consumers.yml` starter leg |
| `@openelement/fixture-third-party-web-components` | yes — but only inside a `mkdtemp` app it scaffolds and then deletes | `tests/fixtures/third-party-web-components/qualify.ts:867` (`runRouterBuild(appDir)`), temp root at `:1171`, removed at `:1372` unless `OPEN_ELEMENT_KEEP_THIRD_PARTY_WC_SMOKE=1` | yes — `published-consumers.yml:105` (`smoke`), not in `autoflow-ci.yml` |
| `@openelement/fixture-web-component-interop` | yes — same shape (temp app built then deleted) | `tests/fixtures/web-component-interop/qualify.ts:836` (`runRouterBuild(appDir)`), temp root at `:2406`, removed at `:2448` unless `OPEN_ELEMENT_KEEP_INTEROP=1` | partially — `autoflow-ci.yml:375` runs only `test` (the vitest unit suite; it does **not** build an app — `interop-qualification.test.ts` imports `qualify.ts` helpers but never calls `runRouterBuild`). The app-building `qualify` entry has **no** CI path |
| `@openelement/fixture-router-nitro` | **no** — a Nitro host, no Router browser build | `tests/fixtures/router-nitro/package.json` has no `build`; `proof.ts:383-392` runs `npx nitro build`; `server/routes/[...path].ts:1` mounts `createOpenElementNitroHandler` | yes — `autoflow-ci.yml:518-520` and `published-consumers.yml:99-100` |
| `packages/*` (protocol, element, compiler, router, create, ui) | no — library packages; `build` is `tsc --noEmit -p tsconfig.json` | `packages/*/package.json` `build` scripts | yes (as `typecheck`-equivalents) |
| `tools/repo`, `tools/release` | no | no `build` script | n/a |
| `@openelement/fixture-url-pattern-list-audit` | no | not a workspace member; no build | no |
| `benchmarks/*` (not workspace members) | no | no `package.json` | no |

### Reading the table

- **Produces a client entry at all**: www, saas, all seven `router-*`/`site-light-probe`
  fixtures, `generated-only`, the starter scaffold, and the two qualify-harness
  temp apps. That is 12 distinct build roots.
- **Produces one in CI** (`autoflow-ci.yml`): www, router-base-path,
  router-native-framework, router-request-time, router-ui-dogfood,
  router-unocss-probe, site-light-probe, starter-smoke = **8**. `saas`,
  `generated-only`, and the `web-component-interop` qualify entry are not in
  `autoflow-ci.yml`. `third-party-web-components` builds one only in
  `published-consumers.yml`, and only in a temp dir it then deletes.
- **Only exists as a test fixture**: every `tests/fixtures/*` row and
  `generated-only`. The two "production" roots are `www` and `apps/saas`.

## Part 2 — checker runs

Every command below is verbatim as run, from `<repo>`.

### www (CI-reachable, production)

Build prerequisite: the www build fails without `generate:all` (the CI step
`site:build` runs it first). Verbatim failure without it:

```
$ node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/www build
...
[build] [3/3] Static site generation - FAILED: SsrRenderError: SSR render failed: SSG pipeline
Build failed: SsrRenderError: SSR render failed: SSG pipeline
Caused by: Build failed with 14 errors:
[UNRESOLVED_IMPORT] Could not resolve '../data/_generated-error-codes.ts' in app/routes/errors.tsx
```

That is the documented generate-before-build ordering, not a defect; after
`generate:all` the build succeeds.

```
$ node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/tools-repo generate:all
...
generate:all: 10 generator task(s) ok (...)
$ node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/www build
[build] Build complete.
$ node tools/repo/check-browser-entry-graph.ts www/dist/client/.vite/oe-browser-entry-graph.json
VIOLATED  www/dist/client/.vite/oe-browser-entry-graph.json — 6 executor-entry module(s) loaded in the browser entry graph
  loaded packages/element/src/internal/compiled/facade-host.ts
    chunk: islands/element-runtime-DO47hmY_.js (islands: open-button, open-cinematic-scroll, open-code-block, open-dragon-live-gaze, open-hero-polish, open-page-rail, open-search, open-theme-toggle)
  loaded packages/element/src/internal/compiled/runtime-program.ts
    chunk: islands/element-runtime-DO47hmY_.js (islands: open-button, open-cinematic-scroll, open-code-block, open-dragon-live-gaze, open-hero-polish, open-page-rail, open-search, open-theme-toggle)
  loaded packages/element/src/internal/compiled/runtime/fresh-dom.ts
    chunk: islands/element-runtime-DO47hmY_.js (islands: open-button, open-cinematic-scroll, open-code-block, open-dragon-live-gaze, open-hero-polish, open-page-rail, open-search, open-theme-toggle)
  loaded packages/element/src/internal/compiled/runtime/hydrate.ts
    chunk: islands/element-runtime-DO47hmY_.js (islands: open-button, open-cinematic-scroll, open-code-block, open-dragon-live-gaze, open-hero-polish, open-page-rail, open-search, open-theme-toggle)
  loaded packages/element/src/internal/compiled/runtime/kernel.ts
    chunk: islands/element-runtime-DO47hmY_.js (islands: open-button, open-cinematic-scroll, open-code-block, open-dragon-live-gaze, open-hero-polish, open-page-rail, open-search, open-theme-toggle)
  loaded packages/element/src/internal/compiled/runtime/program-kernel.ts
    chunk: islands/element-runtime-DO47hmY_.js (islands: open-button, open-cinematic-scroll, open-code-block, open-dragon-live-gaze, open-hero-polish, open-page-rail, open-search, open-theme-toggle)
  report-only: executorSupport 8, serverPrivate 0, authoring 1, leafSurface 12; parsed-only executor residues 0
  executorSupport: packages/element/src/internal/compiled/runtime/blocks-seam.ts, packages/element/src/internal/compiled/runtime/blocks.ts, packages/element/src/internal/compiled/runtime/error-boundary.ts, packages/element/src/internal/compiled/runtime/hydrate-recovery.ts, packages/element/src/internal/compiled/runtime/hydrate-seam.ts, packages/element/src/internal/compiled/runtime/parts.ts, packages/element/src/internal/compiled/runtime/pre-upgrade-events.ts, packages/element/src/internal/compiled/runtime/revive.ts
  authoring: packages/element/src/open-element-implementation.ts
browser-entry-graph: 1 artifact(s) — 0 MET, 1 VIOLATED, 0 UNPROVEN; verdict: VIOLATED (at least one artifact loads a generic executor entry)
$ echo $?
1
```

### apps/saas (production, NOT CI-reachable)

```
$ node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/saas build
[build] Build complete.
$ node tools/repo/check-browser-entry-graph.ts apps/saas/dist/client/.vite/oe-browser-entry-graph.json
VIOLATED  apps/saas/dist/client/.vite/oe-browser-entry-graph.json — 6 executor-entry module(s) loaded in the browser entry graph
  loaded packages/element/src/internal/compiled/facade-host.ts
    chunk: islands/element-runtime-DqzWrSA1.js (islands: notes-live)
  loaded packages/element/src/internal/compiled/runtime-program.ts
    chunk: islands/element-runtime-DqzWrSA1.js (islands: notes-live)
  loaded packages/element/src/internal/compiled/runtime/fresh-dom.ts
    chunk: islands/element-runtime-DqzWrSA1.js (islands: notes-live)
  loaded packages/element/src/internal/compiled/runtime/hydrate.ts
    chunk: islands/element-runtime-DqzWrSA1.js (islands: notes-live)
  loaded packages/element/src/internal/compiled/runtime/kernel.ts
    chunk: islands/element-runtime-DqzWrSA1.js (islands: notes-live)
  loaded packages/element/src/internal/compiled/runtime/program-kernel.ts
    chunk: islands/element-runtime-DqzWrSA1.js (islands: notes-live)
  report-only: executorSupport 8, serverPrivate 0, authoring 1, leafSurface 13; parsed-only executor residues 0
  executorSupport: packages/element/src/internal/compiled/runtime/blocks-seam.ts, packages/element/src/internal/compiled/runtime/blocks.ts, packages/element/src/internal/compiled/runtime/error-boundary.ts, packages/element/src/internal/compiled/runtime/hydrate-recovery.ts, packages/element/src/internal/compiled/runtime/hydrate-seam.ts, packages/element/src/internal/compiled/runtime/parts.ts, packages/element/src/internal/compiled/runtime/pre-upgrade-events.ts, packages/element/src/internal/compiled/runtime/revive.ts
  authoring: packages/element/src/open-element-implementation.ts
browser-entry-graph: 1 artifact(s) — 0 MET, 1 VIOLATED, 0 UNPROVEN; verdict: VIOLATED (at least one artifact loads a generic executor entry)
$ echo $?
1
```

### tests/fixtures/router-ui-dogfood

```
$ node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/fixture-router-ui-dogfood build
[build] Build complete.
$ node tools/repo/check-browser-entry-graph.ts tests/fixtures/router-ui-dogfood/dist/client/.vite/oe-browser-entry-graph.json
VIOLATED  tests/fixtures/router-ui-dogfood/dist/client/.vite/oe-browser-entry-graph.json — 6 executor-entry module(s) loaded in the browser entry graph
  loaded packages/element/src/internal/compiled/facade-host.ts
    chunk: islands/element-runtime-BSqWqhLQ.js (islands: form-probe, open-button, open-dialog, open-dropdown, open-input)
  ... (the same six executor-entry modules, same chunk, same five islands)
  report-only: executorSupport 8, serverPrivate 0, authoring 1, leafSurface 12; parsed-only executor residues 0
browser-entry-graph: 1 artifact(s) — 0 MET, 1 VIOLATED, 0 UNPROVEN; verdict: VIOLATED (at least one artifact loads a generic executor entry)
$ echo $?
1
```

### tests/fixtures/router-native-framework

```
$ node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/fixture-router-native-framework build
[build] Build complete.
$ node tools/repo/check-browser-entry-graph.ts tests/fixtures/router-native-framework/dist/client/.vite/oe-browser-entry-graph.json
VIOLATED  tests/fixtures/router-native-framework/dist/client/.vite/oe-browser-entry-graph.json — 6 executor-entry module(s) loaded in the browser entry graph
  loaded packages/element/src/internal/compiled/facade-host.ts
    chunk: islands/element-runtime-DYNbaxyc.js (islands: note-counter, stream-lit-probe)
  ... (the same six executor-entry modules, same chunk, same two islands)
  report-only: executorSupport 8, serverPrivate 0, authoring 1, leafSurface 5; parsed-only executor residues 0
browser-entry-graph: 1 artifact(s) — 0 MET, 1 VIOLATED, 0 UNPROVEN; verdict: VIOLATED (at least one artifact loads a generic executor entry)
$ echo $?
1
```

### tests/fixtures/site-light-probe

```
$ node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/fixture-site-light-probe build
[build] Build complete.
$ node tools/repo/check-browser-entry-graph.ts tests/fixtures/site-light-probe/dist/client/.vite/oe-browser-entry-graph.json
VIOLATED  tests/fixtures/site-light-probe/dist/client/.vite/oe-browser-entry-graph.json — 6 executor-entry module(s) loaded in the browser entry graph
  loaded packages/element/src/internal/compiled/facade-host.ts
    chunk: islands/element-runtime-hP_MC2cQ.js (islands: gen-light-probe, light-probe-card, light-probe-runtime-carrier, open-light-probe, probe-shadow-card, semantics-probe)
  ... (the same six executor-entry modules, same chunk, same six islands)
  report-only: executorSupport 8, serverPrivate 0, authoring 1, leafSurface 10; parsed-only executor residues 0
browser-entry-graph: 1 artifact(s) — 0 MET, 1 VIOLATED, 0 UNPROVEN; verdict: VIOLATED (at least one artifact loads a generic executor entry)
$ echo $?
1
```

### tests/fixtures/router-base-path — MET, but the entry chunk is gone

```
$ node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/fixture-router-base-path build
[build-client] Building client bundle for 0 island(s)...
[build-client] Island-free client entry - style-only client build, zero client JS
[build-client] Client bundle built -> <repo>/tests/fixtures/router-base-path/dist/client
[build-client] Style-only emission complete: 4 style asset(s), zero client JS
[build] Build complete.
$ node tools/repo/check-browser-entry-graph.ts tests/fixtures/router-base-path/dist/client/.vite/oe-browser-entry-graph.json
browser-entry-graph: 1 artifact(s) — 1 MET, 0 VIOLATED, 0 UNPROVEN; verdict: MET (the supplied artifacts load no generic executor entry — this is not an app-completeness claim)
$ echo $?
0
```

**Finding (builds but no chunk):** the artifact records
`entry.chunkFile = "islands/client.js"`, but
`tests/fixtures/router-base-path/dist/client/islands/` does not exist. The
style-only pass (`build-client.ts:1377`) deletes `dist/client/islands` after the
bundle is emitted, so the artifact names a chunk that is no longer on disk. The
`MET` verdict here is a genuine statement about the captured graph (0 modules
rendered, 1 chunk, 0 islands) and not a false negative — but it is a `MET` on a
build whose browser entry was then discarded, so it should not be read as
"this app ships an executor-free entry".

### tests/fixtures/router-request-time — UNPROVEN (writer-incomplete)

```
$ node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/fixture-router-request-time build
[build] Build complete.
$ node tools/repo/check-browser-entry-graph.ts tests/fixtures/router-request-time/dist/client/.vite/oe-browser-entry-graph.json
UNPROVEN  tests/fixtures/router-request-time/dist/client/.vite/oe-browser-entry-graph.json — artifact-incomplete
  the writer reported an incomplete capture (island-chunk-unresolved)
  an artifact that cannot carry the claim cannot produce evidence
browser-entry-graph: 1 artifact(s) — 0 MET, 0 VIOLATED, 1 UNPROVEN; verdict: UNPROVEN (evidence is missing or incomplete; do not claim MET)
$ echo $?
2
```

Raw artifact:

```json
{
  "schemaVersion": 1,
  "kind": "open-browser-entry-graph",
  "status": "incomplete",
  "reason": "island-chunk-unresolved",
  "diagnostics": ["module-not-in-chunk"]
}
```

Reproduced identically after `rm -rf tests/fixtures/router-request-time/dist`
and a clean rebuild. Cause per the writer
(`packages/router/src/vite/internal/browser-entry-graph.ts:423-430`): an island
module id resolves to zero containing chunks. The client bundle itself is
emitted and referenced (`dist/client/islands/client.js` is present), so this is
an instrumentation gap, not a build failure — and per the checker's contract it
yields no evidence either way.

### tests/fixtures/router-unocss-probe — UNPROVEN (writer-incomplete)

```
$ node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/fixture-router-unocss-probe build
[build] Build complete.
$ node tools/repo/check-browser-entry-graph.ts tests/fixtures/router-unocss-probe/dist/client/.vite/oe-browser-entry-graph.json
UNPROVEN  tests/fixtures/router-unocss-probe/dist/client/.vite/oe-browser-entry-graph.json — artifact-incomplete
  the writer reported an incomplete capture (module-id-unnormalizable)
  an artifact that cannot carry the claim cannot produce evidence
browser-entry-graph: 1 artifact(s) — 0 MET, 0 VIOLATED, 1 UNPROVEN; verdict: UNPROVEN (evidence is missing or incomplete; do not claim MET)
$ echo $?
2
```

Raw artifact:

```json
{
  "schemaVersion": 1,
  "kind": "open-browser-entry-graph",
  "status": "incomplete",
  "reason": "module-id-unnormalizable",
  "diagnostics": ["unresolved-module-id"]
}
```

Cause per `browser-entry-graph.ts:274-279` /
`browser-entry-graph-artifact.ts:472-486`: a module id cannot be placed
workspace-relative. Note the build manifest for this app carries an SVG asset
entry (`_probe-swatch-DDPBt0lr.svg`) — a non-module emission the normalizer does
not place. Full confidence in that attribution would need instrumentation work
that is out of scope here; what is measured is the reason code and its
diagnostic.

### tests/fixtures/router-static-only — no artifact at all

```
$ node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/fixture-router-static-only build
[build-client] Building client bundle for 0 island(s)...
[build-client] Island-free client entry - style-only client build, zero client JS
[build-client] Client bundle built -> <repo>/tests/fixtures/router-static-only/dist/client
[build-client] No server-rendered style edges - zero client JS output
[build] Build complete.
$ node tools/repo/check-browser-entry-graph.ts tests/fixtures/router-static-only/dist/client/.vite/oe-browser-entry-graph.json
UNPROVEN  tests/fixtures/router-static-only/dist/client/.vite/oe-browser-entry-graph.json — artifact-missing
  the artifact file cannot be read
  an artifact that cannot carry the claim cannot produce evidence
browser-entry-graph: 1 artifact(s) — 0 MET, 0 VIOLATED, 1 UNPROVEN; verdict: UNPROVEN (evidence is missing or incomplete; do not claim MET)
$ echo $?
2
```

**Finding (builds but has no artifact):** the build exits 0 and emits no
`dist/client` directory at all (`dist/` holds only `index.html`,
`about/index.html`, `mdx-page/index.html`, and `.openelement/ssg-pages.json`).
The client bundle had genuinely nothing to emit, so
`build-client.ts:1387-1391` removed the whole client dir — the observer's
artifact went with it. For this app "no client JS" is the correct end state; the
evidence instrument simply cannot express it as `MET` (there is no chunk to
inspect).

### tests/fixtures/router-request-time/generated-only (not a workspace member, not in CI)

```
$ cd tests/fixtures/router-request-time/generated-only
$ node ../../../../packages/router/src/cli/build.ts
[build] Build complete.
$ cd <repo>
$ node tools/repo/check-browser-entry-graph.ts tests/fixtures/router-request-time/generated-only/dist/client/.vite/oe-browser-entry-graph.json
browser-entry-graph: 1 artifact(s) — 1 MET, 0 VIOLATED, 0 UNPROVEN; verdict: MET (the supplied artifacts load no generic executor entry — this is not an app-completeness claim)
$ echo $?
0
```

Detail from `--json`: `verdict MET`, `loadedModuleCount 39`, `chunkCount 4`,
`islandCount 1`, `diagnostics.executorSupport []`, `serverPrivate []`,
`authoring []`, `leafSurface` 12 entries (all `generated-element/*`,
`runtime/*` support modules and `protocol/src/part-program.ts`),
`parsedOnlyExecutorResidues []`. This matches the fixture's own stated
expectation (`generated-only/README.md:18-20`).

### @openelement/e2e-starter-smoke (scaffolded `my-blog`)

```
$ node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/e2e-starter-smoke setup
...
starter-smoke ready at <tmp>
$ node tools/repo/check-browser-entry-graph.ts <tmp>
UNPROVEN  <tmp> — artifact-incomplete
  the writer reported an incomplete capture (app-root-outside-workspace)
  an artifact that cannot carry the claim cannot produce evidence
browser-entry-graph: 1 artifact(s) — 0 MET, 0 VIOLATED, 1 UNPROVEN; verdict: UNPROVEN (evidence is missing or incomplete; do not claim MET)
$ echo $?
2
```

Raw artifact: `{"schemaVersion":1,"kind":"open-browser-entry-graph","status":"incomplete","reason":"app-root-outside-workspace","diagnostics":["app-root"]}`.

The scaffold itself built fine and ships a real browser entry
(`dist/client/islands/client.js`, referenced from `dist/index.html` as
`<script type="module" src="/client/islands/client.js">`, alongside
`element-runtime-*.js`, `element-services-full-*.js`,
`island-my-counter-*.js`, `island-live-timer-*.js`, `vite-helper-*.js`).

**Finding (builds but has no usable artifact):** the artifact is structurally
unusable for the P1 predicate. The observer anchors the app root against the
nearest ancestor `pnpm-workspace.yaml`
(`browser-entry-graph.ts:392-403`); the starter scaffold has **no** workspace
file of its own, so the anchor falls back to the app root itself
(`build-client.ts:1155`, `findBuildWorkspaceRootOrUndefined(root) ?? root`) and
`relative(root, root) === ''` is rejected. Note that under the starter-smoke
harness the app *does* get a `pnpm-workspace.yaml` — written by
`setup.ts` for tarball overrides — but it lives inside the app dir, which again
makes the anchor equal the root. The result is that the single most important
production consumer (the shipped template, on three OSes in
`published-consumers.yml`) can never produce `MET` evidence.

Crucially this is **not** a harness artifact: shipping no
`pnpm-workspace.yaml` is an asserted property of the scaffold.
`tools/release/published-consumer-qualification.ts:683` states the scaffold
"ships NO pnpm-workspace.yaml", and `:755-770` fails the published-consumer
qualification if a `pnpm-workspace.yaml` is ever found in the starter dir. So
every installed user project has the shape that trips
`app-root-outside-workspace`.

### @openelement/fixture-third-party-web-components (temp app, retention run)

```
$ OPEN_ELEMENT_KEEP_THIRD_PARTY_WC_SMOKE=1 node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/fixture-third-party-web-components smoke
...
Keeping third-party WC qualification project at <tmp>
$ node tools/repo/check-browser-entry-graph.ts <tmp>
UNPROVEN  <tmp> — artifact-incomplete
  the writer reported an incomplete capture (app-root-outside-workspace)
  an artifact that cannot carry the claim cannot produce evidence
browser-entry-graph: 1 artifact(s) — 0 MET, 0 VIOLATED, 1 UNPROVEN; verdict: UNPROVEN (evidence is missing or incomplete; do not claim MET)
$ echo $?
2
```

The build itself was green (`pnpm run build` in the scaffold succeeded; the
harness reported `0/11 T0 proved` for its own browser tiers, which is that
harness's separate startup-budget concern, not a build failure).

### @openelement/fixture-web-component-interop (temp app, retention run)

```
$ OPEN_ELEMENT_KEEP_INTEROP=1 node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/fixture-web-component-interop qualify
...
Keeping interop temporary app at <tmp>
$ node tools/repo/check-browser-entry-graph.ts <tmp>
UNPROVEN  <tmp> — artifact-incomplete
  the writer reported an incomplete capture (app-root-outside-workspace)
  an artifact that cannot carry the claim cannot produce evidence
browser-entry-graph: 1 artifact(s) — 0 MET, 0 VIOLATED, 1 UNPROVEN; verdict: UNPROVEN (evidence is missing or incomplete; do not claim MET)
$ echo $?
2
```

**Consolidated finding — `app-root-outside-workspace` falsifies the whole
scaffold class.** Three independent build roots fail the same way, all for the
same reason: `www`/`apps/saas`/fixtures are *inside* the monorepo's workspace
anchor, but every app the product actually ships to users is a standalone
directory whose own `pnpm-workspace.yaml` (or absence of one) makes
`findBuildWorkspaceRootOrUndefined(root) ?? root` resolve to the app root, so
`relative(root, root) === ''` is rejected at
`browser-entry-graph.ts:396-403`. Any generated app — the starter template, the
interop corpus app, the third-party WC app — can therefore never produce a
recomputable P1 artifact. This is a report-only instrumentation limitation (the
builds all exit 0), not a build defect, and per the checker's contract an
`UNPROVEN` artifact yields no evidence in either direction.

## Part 3 — coverage statement

### What the current tree does cover

Artifacts that produced a recomputable verdict:

| artifact | verdict | meaning |
| --- | --- | --- |
| `www/dist/client/.vite/oe-browser-entry-graph.json` | `VIOLATED` | 6 executor-entry modules loaded in `islands/element-runtime-DO47hmY_.js`, attributed to 8 islands |
| `apps/saas/dist/client/.vite/oe-browser-entry-graph.json` | `VIOLATED` | 6 executor-entry modules loaded in `islands/element-runtime-DqzWrSA1.js`, attributed to `notes-live` |
| `tests/fixtures/router-ui-dogfood/...` | `VIOLATED` | 6 loaded, 5 islands |
| `tests/fixtures/router-native-framework/...` | `VIOLATED` | 6 loaded, 2 islands |
| `tests/fixtures/site-light-probe/...` | `VIOLATED` | 6 loaded, 6 islands |
| `tests/fixtures/router-base-path/...` | `MET` | 1 chunk, 0 modules, 0 islands — a style-only build whose `islands/client.js` was deleted after emission |
| `tests/fixtures/router-request-time/generated-only/...` | `MET` | 39 loaded modules, 4 chunks, 1 island, no executor entries |

Combined multi-artifact run (the nine artifacts above):

```
$ node tools/repo/check-browser-entry-graph.ts \
    www/dist/client/.vite/oe-browser-entry-graph.json \
    apps/saas/dist/client/.vite/oe-browser-entry-graph.json \
    tests/fixtures/router-ui-dogfood/dist/client/.vite/oe-browser-entry-graph.json \
    tests/fixtures/router-native-framework/dist/client/.vite/oe-browser-entry-graph.json \
    tests/fixtures/site-light-probe/dist/client/.vite/oe-browser-entry-graph.json \
    tests/fixtures/router-base-path/dist/client/.vite/oe-browser-entry-graph.json \
    tests/fixtures/router-request-time/dist/client/.vite/oe-browser-entry-graph.json \
    tests/fixtures/router-unocss-probe/dist/client/.vite/oe-browser-entry-graph.json \
    tests/fixtures/router-request-time/generated-only/dist/client/.vite/oe-browser-entry-graph.json
browser-entry-graph: 9 artifact(s) — 2 MET, 5 VIOLATED, 2 UNPROVEN; verdict: VIOLATED (at least one artifact loads a generic executor entry)
```

So: the P1 predicate is **VIOLATED** on the current tree — but only 7 of the 9
supplied artifacts carry a recomputable verdict, and neither `UNPROVEN` artifact
is evidence of anything except an instrumentation gap.

Counting every `build.ts` app root measured in this record: 13 roots were built
(12 emit a client entry; `fixture-router-static-only` emits none). 7 produced a
recomputable verdict (5 `VIOLATED`, 2 `MET`) and 6 produced no usable evidence
(2 writer-incomplete, 1 artifact-missing, 3 `app-root-outside-workspace` — the
starter scaffold and the two qualify-harness temp apps).

### What the current tree does NOT cover

Production browser entries with **no** P1 evidence at all:

1. **The shipped starter template** (`@openelement/create` → `my-blog`) — builds,
   ships a real client entry, produces `app-root-outside-workspace` →
   `UNPROVEN`. This is the highest-value gap: it is the consumer every new user
   gets, and it is qualified on three OSes in `published-consumers.yml`.
2. **`@openelement/saas`** — a real first-party production app. It builds and
   the checker says `VIOLATED`, but **no CI workflow ever builds it**, so no
   automated verdict exists for any commit. (`autoflow-ci.yml` mentions no saas
   task; `.github/CODEOWNERS:19` is its only `.github` reference.)
3. **`tests/fixtures/router-request-time`** — CI-reachable (`autoflow-ci.yml:514`
   runs its `gate`, which builds it), but the build's artifact is
   `island-chunk-unresolved` → `UNPROVEN`. A green fixture gate therefore proves
   nothing about P1 for this fixture.
4. **`tests/fixtures/router-unocss-probe`** — CI-reachable
   (`autoflow-ci.yml:504`), artifact `module-id-unnormalizable` → `UNPROVEN`.
5. **`tests/fixtures/router-static-only`** — CI-reachable
   (`autoflow-ci.yml:499`), builds but emits no client directory and therefore no
   artifact. (Arguably not a browser-entry app at all — its build log says
   "zero client JS output" — but it is listed as buildable, so it is recorded
   here.)
6. **`@openelement/fixture-third-party-web-components`** and
   **`@openelement/fixture-web-component-interop`** — both build a temp app and
   both are `UNPROVEN` with `app-root-outside-workspace`. For the third-party
   fixture that is the only CI leg (`published-consumers.yml:105`); for interop
   the app-building entry has no CI path at all (`autoflow-ci.yml:375` runs only
   the unit suite).
7. **`@openelement/fixture-router-nitro`** — correctly out of scope (no Router
   browser build; it is a Nitro host over `nitro-mount.ts`).

`tests/fixtures/router-request-time/generated-only` **is** covered, but only by
hand: it is not a workspace member and no gate builds it, so its `MET` exists at
this SHA and nowhere in CI.

Additionally, the checker is **not wired to any gate**. `browser-graph:check`
exists only as a `tools/repo` script (`tools/repo/package.json:7`) and appears in
no `gate.ts` step list, no `autoflow-ci.yml` step, and no `git` hook. Nothing in
CI runs it, so even the 7 covered artifacts above are covered only by this
manual run.

### Explicit "not claimed" list

Not measured, and therefore not claimed in either direction:

- **The starter scaffold and the two qualify-harness apps, as runtime
  behavior**: their artifacts are `UNPROVEN`, so nothing is claimed about
  whether their client graphs load the executor. (Their builds are green and
  the artifacts fail structurally; that is the whole claim.)
- **Every app built on any platform other than this macOS arm64 host** — Node
  24.18.0, pnpm 12.8.1, vite 8.1.6 as installed here. Chunk hashes in the
  verdicts above are host- and build-specific and are not stable identifiers.
- **The `VIOLATED` artifacts' behavior across engines** — the checker is a
  static graph read; it says nothing about runtime behavior, and this record
  ran no browser.
- **The `parsedOnlyExecutorResidues` values** — all seven artifacts that carry a
  verdict (5 `VIOLATED` + 2 `MET`) report `0`; this was read from normal output,
  not cross-checked against a second instrument.
- **Any app outside this workspace** (published npm consumers, deployed
  Cloudflare workers beyond what `saas` builds locally).
- **Whether the `module-id-unnormalizable` cause in `router-unocss-probe` is
  specifically the SVG asset** — offered as the most likely explanation from the
  build manifest, not proven.
- **`apps/saas`'s Nitro/deployed output** (`.output-workers`): only its Router
  `dist/` was measured. `nitro:build-workers` was not run.

## Reproducing

```sh
cd <repo>
pnpm install --frozen-lockfile
node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/tools-repo generate:all   # prerequisite for www
node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/www build
node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/saas build
node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/fixture-router-ui-dogfood build
node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/fixture-router-native-framework build
node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/fixture-site-light-probe build
node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/fixture-router-base-path build
node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/fixture-router-request-time build
node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/fixture-router-unocss-probe build
node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/fixture-router-static-only build
(cd tests/fixtures/router-request-time/generated-only && node ../../../../packages/router/src/cli/build.ts)
node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/e2e-starter-smoke setup
# then, per artifact:
node tools/repo/check-browser-entry-graph.ts <app>/dist/client/.vite/oe-browser-entry-graph.json
```

No production source and no test file was modified to produce this record.
Every artifact above lives under a Git-ignored `dist/`; `git status
--porcelain` was empty after the measurement runs.

## Disposition (2026-11-18)

What this record changed in the tree:

- **Fixed** (`7d827febc`): the installed-consumer capture defect. `app.root` may
  now be `.` — the honest spelling for "this app IS the workspace root" — so a
  project created outside this monorepo can be captured at all. Without it the
  whole shipped-consumer class was `UNPROVEN` by construction.

What this record deliberately did NOT change, and why:

- **`browser-graph:check` is still wired to no gate.** Wiring it today would make
  every gate run RED forever, because `www` is measured VIOLATED: the shared
  `element-runtime` chunk still carries the six executor entries, reached by the
  class-lane pages in the client graph. A gate that cannot pass is not a gate; it
  is a permanently-lit warning light, and this repo's convention is that a gate
  is green or the build stops. It gets wired when P1 is MET — at that point it
  becomes the anti-regression guard it was written to be, not a red light.
- **`@openelement/saas` has no CI build.** Recorded as a coverage gap rather than
  papered over by adding one: adding a CI leg is a release-lane decision (cost,
  budget, matrix shape), not a fix to this record.
- **The two incomplete CI-reachable captures** (`router-request-time`,
  `router-unocss-probe`) are recorded as findings. Their `UNPROVEN` verdicts are
  the checker doing its job; the defects behind `island-chunk-unresolved` and
  `module-id-unnormalizable` are separate slices.

Reading order for anyone judging P1: this record states WHAT is decidable and
what is not; the checker states the per-artifact verdict; the class-lane
participation is the reason `www` is VIOLATED.

## The exact dependency chain to P1 MET (measured 2026-11-18)

The `www` artifact names eight islands sharing one chunk:

```
open-button, open-cinematic-scroll, open-code-block, open-dragon-live-gaze,
open-hero-polish, open-page-rail, open-search, open-theme-toggle
```

That chunk (`islands/element-runtime-<hash>.js`) contains BOTH:
- the generated-element shell (`generated-element/{shell,root,dsd-ssr}.ts`), and
- the six executor entries (`facade-host`, `runtime-program`,
  `runtime/{kernel,program-kernel,hydrate,fresh-dom}`).

So the executor is reachable not because any generated component uses it, but
because the bundler merged two lanes' dependencies into one chunk. Measured, not
inferred: walking `shell.ts`'s relative-import closure visits **25 modules and
hits ZERO executor entries**.

Two consequences, both actionable:

1. **Nothing on the generated side keeps the executor alive.** A generated island
   can be fully migrated and still sit in that chunk; its own contribution is
   clean.
2. **P1 flips when the CLASS-lane islands leave the graph.** Of the eight, the
   remaining class-lane ones are `open-search` and `open-page-rail` (the other six
   are generated or already migrated). Migrating those two — or removing them
   from the production browser graph — is the P1 lever, not any change to the
   generated lane.

This is why the consumer-migration map and the P1 verdict are the same story told
twice; the map lists what has to move, this record explains why moving it is what
turns the verdict.

## CORRECTION (2026-11-18): the P1 lever is NOT the two islands

An earlier section of this record said P1 flips when `open-search` and
`open-page-rail` migrate. That was wrong, and a migration attempt disproved it.

Measured: the shared `element-runtime` chunk contains `element/src/index.ts`,
`runtime/hydrate-install.ts`, `runtime/blocks-install.ts` and
`open-element-implementation.ts`. Those are pulled in by the **34 class
components** that import `from '@openelement/element'` (the root entry, whose top
two statements install the hydration executor and the when/each builders).
`layout.tsx` is not in that chunk — it is the ARTICLE-ROUTE components and the
other class pages that reach the root entry.

So migrating an island does not change the chunk: the island's own lane fact is
irrelevant to what else the chunk carries. The migration attempt confirmed it —
the verdict before and after was byte-identical, with `open-page-rail` still
listed among the chunk's islands.

The real lever, therefore, is: **no production browser graph may import
`@openelement/element`'s ROOT entry.** That is a 34-file question across
`www/app/components/article-routes/` (27 generated modules), `www/app/site-ui/`
and `layout.tsx` — the consumer-migration map, not the island list. It also
explains why `./base`/`./client-only` exist and why moving a CLASS page onto them
is not possible: a class component's claim needs the installed executor
(recorded earlier in 16b-migration-note.md).

This correction supersedes the "exact dependency chain" section above wherever the
two disagree.
