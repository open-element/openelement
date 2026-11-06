# Platform catch-up review — alpha.8 … alpha.15

[design-principles.md § Platform catch-up review](../architecture/design-principles.md#platform-catch-up-review)
requires one review per release cycle: list the framework code the platform (or
the maintained toolchain) has newly made redundant, delete it, and re-measure
renderer forks and optional modes against the same ruler so the backlog shrinks
toward primitives. This file is the per-release ledger for the `1.0.0-alpha.8`
… `1.0.0-alpha.15` line. The cycle before it is recorded as a nil-return in
the alpha7 design review (internal, not published);
this file continues that record from alpha.8 onward.

## Method and sources

- **Pins** are read from the release commit itself:
  `git show <sha>:.node-version`, `git show <sha>:package.json`,
  `git show <sha>:tools/repo/package.json`,
  `git show <sha>:packages/router/package.json`.
- **Reviewed changes** are read from the release window's commits and PR
  numbers (`git log <previous-release>..<release>`) and from the release's
  CHANGELOG section. Upstream statements are never paraphrased from memory: the
  row cites the commit subject or the changelog text it comes from.
- **Record status.** A row marked **recorded** had a contemporaneous platform
  statement at that release. A row marked **当时未记录，补录** (not recorded at
  the time; backfilled) has no contemporaneous review record — the row states
  only what the tree at that commit and the window's commits prove, and it is a
  backfill, not a retroactive claim that a review happened.

## Standing pins across the line

Nothing on the platform pin surface moved between alpha.8 and alpha.15 — the
line rides one Node/pnpm/Vite/TypeScript set from the alpha.8 host port onward.

| Pin | Value at every release alpha.8 … alpha.15 | Source |
| --- | --- | --- |
| Node development line | `24.18.0` | `.node-version` at each release commit |
| Node floor (repo + generated projects) | `engines.node: ">=24.2"` | root `package.json`; introduced by the alpha.8 platform train (`e78fa3db3`, #1509) |
| Package manager | `pnpm@12.8.1` | root `package.json` `packageManager` |
| Vite | `8.0.16` (router peer range `^8.0.0`) | root `devDependencies`, `packages/router/package.json` |
| TypeScript | `6.0.3` | root and `tools/repo` `devDependencies` |
| vitest | `5.0.2` | root `devDependencies` |
| @types/node | `26.5.0` | `tools/repo/package.json` |
| oxlint / oxfmt | `1.85.0` / `0.70.0` | root `devDependencies` |

## Release ledger

### 1.0.0-alpha.8 — 2026-10-05, `cf6b52fb1` (#1515), platform train `e78fa3db3` (#1509)

- **Platform changes reviewed — recorded.** The whole release is a platform
  train: the Deno host retires in favor of Node/pnpm. The changelog section
  states the facts (`.dvmrc` → `.node-version` 24.18, Node 24+ floor for
  generated projects "stated per verified fact", one pnpm workspace and
  lockfile, vitest everywhere, CI on the Node task surface), and
  [ADR-0161](../adr/ADR-0161-node-pnpm-consumer-surface.md) records the
  consumer-surface decision (superseding ADR-0108).
- **Platform-redundant code deleted.** The ports-and-adapters bridge and its
  gate; every `Deno.*` runtime API in product and tooling source; 19 `deno.json`
  manifests; 7 `deno.lock` files; the vendor/`nodeModulesDir` machinery; the
  JSR publish config. `tools/repo/node-command.ts` is added as the one spawn
  helper for the `node:*` world (later reshaped by #12 of the shim inventory).
- **Residues tracked, not hidden.** The internal node-porting residuals record
  (not published) records what the port left behind and each residue's expiry path.
- **Status: recorded.**

### 1.0.0-alpha.9 — 2026-10-05, `7816f3937` (#1519), styling train `b7cdb578d` (#1518)

- **Platform changes reviewed — 当时未记录，补录.** The window's verifiable
  platform facts: `@tailwindcss/vite` 4.3.3 enters the Router Vite seam as an
  optional peer, default OFF (#1505, changelog); the published-consumer
  verifier learns to install Vite and to resolve Windows command shims
  (`89cb3c51f`, #1517) — a platform fact about `node_modules/.bin` on win32.
  No pin moved.
- **Platform-redundant code deleted.** The session's own styling machinery is
  replaced by the Tailwind theme contract (one `@theme` source); the deleted
  surface is the parallel color/preset path, not a platform duplication.
- **Status: 当时未记录，补录.**

### 1.0.0-alpha.10 — 2026-10-06, `661bbf6b6` (#1542), size lane `ca4671c75` (#1543–#1555)

- **Platform changes reviewed — 当时未记录，补录.** Verifiable facts: **esbuild
  is retired from the toolchain** (13 config blocks migrate to oxc — changelog
  §1.0.0-alpha.10); production builds strip the largest runtime error prose
  through the bundler's `define` channel (`#1546`); the compiled element runtime
  is homed in one guarded shared chunk using the bundler's own chunking
  (`#1544`).
- **Platform-redundant code deleted.** The esbuild configuration surface; the
  island CSS minification transform is added here and later retired in alpha.15
  (shim inventory #1, deleted in #1558).
- **Status: 当时未记录，补录.**

### 1.0.0-alpha.11 — 2026-10-08, `70784ccf4` (#1578), closeout `fe39b1b02` (#1557 #1558 #1556 #1560)

- **Platform changes reviewed — 当时未记录，补录** (the closest thing to a
  record is the closeout commit's own body, which states the decisions).
  Verifiable facts:
  - **Navigation API** adapter with a native path and a `pushState` fallback,
    the fallback carrying its own retirement condition (#1561).
  - **View Transitions** admitted as an opt-in `RouterOptions` mode, default
    off, as a NAMED DEVIATION with a written retire condition: headless
    Chromium 147's view transitions swallow trusted anchor navigate events
    (10/10 reproducible) — the deviation retires when Chromium fixes it.
  - **Speculation Rules** prefetch is replaced by `<link rel="prefetch"
    as="fetch">` after an external audit showed Speculation Rules only target
    documents, not sub-resources: the platform's own resource channel was the
    correct primitive (#1561 P1).
  - **CSS `@scope`** becomes the light-DOM styling boundary (replacing the text
    scan that could not express it).
  - **Hono becomes optional** in the router's dependency surface (#1557).
- **Platform-redundant code deleted.** The Deno-era file/`deno.json` export
  machinery and the monolithic element package (three-package split, #1557);
  the island-CSS string-template authoring form (#1558); the Speculation Rules
  emission.
- **Shim registry created here.** #1559 lands `docs/architecture/shim-inventory.md` (17 items,
  each with a retirement condition) — the P5 registry this file's reviews feed.
- **Status: 当时未记录，补录.**

### 1.0.0-alpha.12 — 2026-10-08, `e1d4cf084` (#1587), hotfix `c954626d6` (#1586)

- **Platform changes reviewed — 当时未记录，补录.** Verifiable facts: the dev
  channel's Tailwind preset token delivery is repaired through the dev server's
  own module graph; the alpha.11 post-release follow-ups make `prepare`
  cross-platform (`a427c1560`, #1581). No pin moved.
- **Platform-redundant code deleted.** None in this window (a hotfix train).
- **Status: 当时未记录，补录.**

### 1.0.0-alpha.13 — 2026-10-10, `6173669ab` (#1588)

- **Platform changes reviewed — 当时未记录，补录.** Verifiable facts: the
  generated starter's lifecycle moves onto the packed router `bin`; the Vite
  dev server and its Hono peer, Tailwind, TypeScript and Vite itself move out
  of the starter's runtime dependencies into devDependencies; `pnpm update`
  picks up later `1.0.0` prereleases by policy (changelog §1.0.0-alpha.13).
- **Platform-redundant code deleted.** The starter's hand-written dev/build
  wiring that the packed CLI replaces.
- **Status: 当时未记录，补录.**

### 1.0.0-alpha.14 — 2026-10-10, `e9af510de` (#1592), feature train `d7b2f46ba` (#1590)

- **Platform changes reviewed — 当时未记录，补录.** Verifiable facts: the
  starter ships the Vite+ form (`vp dev` / `oe build` / `vp fmt` / `vp lint`),
  `vite` is no longer a template dependency, and the template workspace carries
  the Vite+ catalog, a `vite@*` override and minimum-release-age excludes for
  the Vite+ line (changelog §1.0.0-alpha.14).
- **Platform-redundant code deleted.** The plain-Vite starter form is retired
  in favor of the Vite+ form (the reverse decision lands one release later).
- **Status: 当时未记录，补录.**

### 1.0.0-alpha.15 — 2026-10-18, release stamp `3fea40ce6`, changelog `8e487887f`

- **Platform changes reviewed — recorded by this batch.** Verifiable facts in
  this window:
  - **The Vite+ starter form is retired; the scaffold is package-manager
    neutral** (`69444c845`): every `catalog:` reference leaves the shipped
    payloads, `vite-plus` is no longer a template dependency, `vite` is pinned
    to the router's own 8.0.16, and the template workspace file is deleted.
    One `vp` entry surface remains for the repository's own gates
    (`88bda88bf`).
  - **Node's strip-only type transform constrains shipped source**
    (`4b526ef35`): constructor parameter properties are rejected by packed
    consumers running the compiler tarball under Node's type stripping, so the
    emitter declares fields explicitly. This is the platform fact behind the
    `>=24.2` floor's practical meaning for shipped source.
  - **Zero-island pages stop paying for the runtime** (`4aa6b247a`): the entry
    carries no static element-package import and the runtime becomes a
    per-page projection with modulepreload only on pages whose island manifest
    is non-empty — measured ~29 KB gzip removed from an `/about` page on the
    packed-starter shape.
  - **WebKit's adoption-upgrade gap bites a new place** (`1f7c57717`, quirk
    #604): an island whose definition lands after the morph is repaired from
    the island-loaded hook; Chromium and Firefox upgrade the adopted element
    regardless — engine behavior, not a framework defect.
  - **CSS `@scope` projection is token-based** (`851d1bc9a`): only real
    `:host`/`::slotted` selector tokens are rewritten, case-insensitively;
    escaped identifiers, declaration values and at-rule preludes stay alone.
  - **A CLI build is a production build** (`470fd991e`, KR-15): the build pins
    production semantics for its Vite call so ambient
    `NODE_ENV=test/development` cannot emit a development-semantics SSR bundle.
  - **Two utility engines, one declared port** (`99e2e88fb`, `2dd5a142d`):
    UnoCSS enters behind the same declaration surface as Tailwind
    (ADR-0168), which is the anti-duplication check for the provider seam.
  - **Request-time rendering gets its own authored surface**
    (`2f85a43d9`, server function pages): `@openelement/element/server`
    (`__h`/`__t`/`__ssr`) and the `function-page` descriptor —
    [ADR-0169](../adr/ADR-0169-request-time-rendering-surface.md).
- **Platform-redundant code deleted.** `vite-plus` as a shipped template
  dependency; the pnpm-only `catalog:` protocol from the payload; the
  island-CSS minification transform (`island-css.ts`, #1558 — inventory #1);
  the `styleAssetProtocol` admission switch (#1558 — inventory #2); the
  `./no-regions` subpath (ADR-0166 amendment).
- **Status: recorded — this ledger entry is the alpha.15 review.**

## Post-ledger correction (2026-11-05): JSR residue retired

The alpha.8 entry above records the contemporaneous deletion of the JSR
publish config and is left as written. Two residue classes survived that
entry's wording and are closed now:

- **The `npm.jsr.io` mirror is not an allowed registry host.** The
  dependency-age gate queries `registry.npmjs.org` only; a lockfile tarball
  naming the JSR mirror fails closed before any cache lookup or request
  (`tools/repo/check-dependency-age.ts`).
- **JSR dependency inputs are rejected, not filtered.** Release tooling
  accepts no `jsr:`, `@jsr/`, `@std/`, or `npm:@jsr/` dependency value in a
  packed manifest, and no such specifier in a packed module. The JSR input
  path is retired; npm is the only public registry
  ([ADR-0161](../adr/ADR-0161-node-pnpm-consumer-surface.md)).

## What this ledger does not claim

- No release below alpha.15 had a contemporaneous platform catch-up record; the
  backfilled rows are reconstructions from the tree and the window's commits,
  limited to what those sources prove.
- Upstream versions newer than the standing pins (later Node lines, Vite 9,
  TypeScript 7 / tsgo, new browser baselines) were not part of any reviewed
  window here and are not evaluated by this file. The next cycle's review
  starts from the standing-pins table above.
- The per-release finding "no platform-redundant code" is only asserted where
  this ledger says so explicitly; silence in a row is a missing record, not a
  nil-return.
