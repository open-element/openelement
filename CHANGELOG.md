# Changelog

All notable user-visible changes are recorded here, newest first. This is an
aggregated historical archive, not a release-by-release record; details for
individual versions are recoverable from Git history. Current product truth
lives in:

- [`docs/architecture/product-model.md`](./docs/architecture/product-model.md)
- [`docs/release/release-state.json`](./docs/release/release-state.json)
- [`docs/release/public-interface-snapshot.json`](./docs/release/public-interface-snapshot.json)

## 1.0.0-alpha.5

**Rendered as data resolves: part-level streaming, WC admission tiers, runtime
convergence.** ADR-0157/0158/0159 are accepted (2026-09-25 owner ruling). The
qualification evidence boundary — including honest negatives (T1 offline
snapshot falsified, third-party components verified shell-born only) — is
recorded in [`docs/release/alpha5-qualification.md`](./docs/release/alpha5-qualification.md).

- **Element / Router — rendered as data resolves:** opted-in dynamic document
  GETs may defer eligible compiled text/Region Parts after status, security,
  headers and Cookie decisions. The same Part Program still drives SSR, fresh
  DOM and claim; server Part backfill is independent of island hydration.
  Actions and non-opted-in/static routes retain their non-streaming paths.
- **Element — ownership and keyed identity:** a single internal tree-shaped
  lifetime scope owns component activations and child Part/Region resources;
  it preserves DOM on disconnect and removes owned ranges on replacement.
  Keyed reorders retain stationary node identity/focus and use bounded moves.
  Old Part Program material is retained; no cross-alpha migration is implied.
- **Router — internal renderer selection:** Native/Lit imports and hydration
  ownership converge behind an internal adapter without a public renderer
  plug-in SDK or a third rendering path.
- **Evidence, not support expansion:** the Native reference route exercises a
  delayed Part, late failure, no-JS tail and ordinary POST action against a
  non-streamed comparison route. Local raw measurements are advisory. The WC
  snapshot experiment does not grant Lit-in-stream or T1/T2; a Workers module
  call is not a real deployment. Bun remains advisory.

## 1.0.0-alpha.4

**Self-consistency train: the shipped package manifest stops lying about a
module that installs itself, the candidate gate stops re-proving content it has
already proved, and the config, error and navigation surfaces are converged.**
The source line is `1.0.0-alpha.4`; npm publication is a separate, gated step,
so `docs/release/release-state.json` records registry truth (`@alpha` =
`1.0.0-alpha.3`) and this train's own version stays a repository baseline until
a post-publish sync. **No migration steps** beyond one retired spelling noted
below, so an alpha.3 consumer upgrades with no action.

- **Release — the packed Element entry declares its claim seam (#1425)**: the
  published `sideEffects: false` on `@openelement/element` was wrong, and it
  shipped a real defect. The default entry installs the compiled claim executor
  through an import-time seam (`src/index.ts` bare-imports
  `internal/compiled/runtime/claim-install.ts`, which calls
  `installClaimExecutor(...)` at module scope), so a consumer's own bundle
  dropped both halves: the bare import reads as an unused statement in a
  side-effect-free module and the installer body has no used exports. Every
  island that had to adopt server-rendered DOM then threw
  `[compiled-kernel] existing DOM in the resolved root needs the claim
  executor` — the packed-starter browser matrix failed 3/3 browsers, and the
  failure was reproduced in the consumer's own client bundle
  (`island-app-shell-*.js`), not inferred. The manifest now names both sides of
  the edge (`./src/index.js` and
  `./src/internal/compiled/runtime/claim-install.js`; naming only one still
  drops the other, pinned by test), and `pack-surface.ts` gained the
  fail-closed `findUndeclaredSeamInstalls` rule: a module-scope `installX(...)`
  in a package whose `sideEffects` does not name that module is exactly the
  shape that ships looking correct and breaks at runtime. The client-only
  reduction from #1416 is unaffected — that entry imports neither module.
  **This is the one item here that changes what a consumer downloads, and it
  takes effect only at the next publish**: every `1.0.0-alpha.3` already on npm
  still carries the wrong manifest, so a starter installed from it today
  silently does not hydrate.
- **Release — the browser-matrix skip is gone (#1425)**: with the root cause
  fixed, `OPEN_ELEMENT_SKIP_BROWSER_MATRIX` and every workflow injection of it
  are deleted. The packed-starter matrix, the dev continuation probe and the
  start continuation probe are unconditionally required again, so the
  qualification that caught this defect runs on every candidate. No tracked
  file mentions the variable any more (the alpha.3 entry above and ADR-0155
  keep their historical narration, which is a record, not a guard).
- **CI — tree-SHA evidence reuse (#1425 follow-up, ADR-0156)**: a green
  evidence package proves a TREE, not a commit — every record carries `sha`
  and `tree`, every log is bound to the tree by its clean-proof line, and every
  tarball is byte-hashed. Two commits with the same tree have byte-identical
  content, so a merge that stales `dev` no longer forces ~1–2 hours of runner
  time re-measuring content the suite has already measured. A new read-only
  `reuse` job (with exactly `contents: read` and `actions: read`) resolves the
  newest in-window successful run whose API-computed commit tree equals the
  candidate's and that carries every lane's artifact; the four lanes `needs:
  reuse` and, when it resolves, replay a verified no-op that downloads the
  source run's evidence and stamps `reused: {runId, sha}`. Reuse is strictly
  tree equality, and the paths out are fail-closed and total: no match, any API
  error, no token, or a run outside the retention window all resolve to
  `reused=false` and every lane then runs its full gate. The aggregate does not
  trust the resolver — it still requires each record's `tree` to equal the
  checked-out tree and additionally rejects a stamp naming the candidate's own
  commit, a stamp disagreeing with the record's `sha`, and a bundle whose
  reused jobs name more than one source run; the clean-proof lines, step argv
  and the Site E2E `candidateSha` are all bound to the record's own `sha`. A
  resolver job failure fails the aggregate rather than degrading silently. The
  decision record is `docs/adr/ADR-0156-tree-sha-evidence-reuse.md`, including
  its P7 four-question review and the rejected alternatives (message-scoped
  reuse, per-lane resolution, a checked-in tree→run index).
- **CI — every remaining lane is bounded, and a red Site E2E run now stages its
  evidence (#1402, #1409)**: `dependency-review`, `codeql#analyze` and both
  `published-consumers` jobs had no ceiling, so a stalled extractor or a hung
  published-starter qualification could hold a runner for the platform default
  (six hours for CodeQL); each now carries one sized to its real work. The
  fresh-clone lane used to run its Site E2E suite before staging the report, so
  a failing suite threw past the staging step and its bundle carried logs but
  no report — the failing test's name was then unrecoverable without a live
  repro, which is exactly the class the alpha.2 closeout could not diagnose. A
  red run is now recorded before it is raised: the raw report plus sidecar are
  staged whenever the runner managed to write them, `ran: false` when it did
  not, and the failure is re-raised after `result.json` so the exit status and
  the validator's verdict are unchanged. A red run still cannot smuggle a pass
  — the aggregate fails closed on a red or absent sidecar and rebinds the
  report bytes to the candidate commit.
- **Router — the accepted config surface grows to eleven keys, and head becomes
  structured (#1411 follow-up)**: `dirs: { routes, islands, components }` moves
  the source roots (the tokens / app-shell / head conventions follow the three
  roots' shared base, so a full `src/*` move carries them); `packageIslands`
  additionally derives `ssr.noExternal` so a listed package's islands are
  bundled, with no public `ssr.noExternal` key; `head.scripts` and
  `head.stylesheets` join the config file, so a config entry and an inline
  `inject.scripts` entry emit the same bytes through one serializer;
  `speculation`, `viewTransition`, `build.manifestBudget` and `i18n` validate
  as data. Raw markup stays out on purpose — `inject` is deliberately not a
  config key. The new `app/head.tsx` convention carries the structural head a
  URL list cannot express (preloads, icons, feed links, inline CSS); it is
  compiled into the app's module graph, not read as text, because
  `loadConfigFromFile` refuses a `?inline` CSS import. Entries are validated at
  the boundary — unsafe attribute names, non-string values, `javascript:`
  URLs, `@import` and unclosed `<style>` all fail the build instead of being
  silently dropped. An accepted head key that no code reads fails closed too.
  Two latent build-context bugs surfaced and are fixed: config-file i18n
  options never reached the integration (the context derived them before the
  config resolved, so the SSG emitted a single-locale site with `locales="[]"`),
  and the head compile now keeps bare specifiers external instead of bundling
  package sources into a data module.
- **Retired — inline `openElement({ html })` (#1411 follow-up)**: the flat
  `html` option is gone and fails closed with `CONFIG_RENAMED_KEY` naming
  `head`. This is the one authored-spelling change in this train: six fixtures,
  three packed-consumer harnesses, `apps/saas` and the Site itself are migrated
  in the same train. `middleware.use` deliberately stays inline-only (the
  config file's `middleware` block carries `corsOrigin`), and
  `/guide/configuration` now says the two are either/or rather than mixing
  them, which remains a hard error.
- **Element — one error dialect, mechanically enforced (#1386)**: the package
  used to raise failures through four conventions (OEC diagnostics,
  `OpenElementError` with codes, ~40 bare `Error`s carrying `[compiled-*]`
  prefixes, and three dedicated exception classes), so a consumer could not
  catch a failure by code without importing every class and pattern-matching
  the rest. `OpenElementError` and its per-surface code catalogue now live in
  `internal/protocol/errors.ts` — import-free, so the ADR-0148 semantic core
  and the Part Program protocol raise framework errors without gaining host
  state — and every throw in `packages/element/src` speaks it. The released
  values (`OPEN_ELEMENT_COMPILED_CLAIM_MISMATCH`,
  `OPEN_ELEMENT_COMPILED_PROGRAM_INVALID`, `OE_PROGRAM_MISSING`,
  `SSR_DOM_ACCESS_UNSUPPORTED`) are pinned so a later cleanup cannot rename
  them; new codes use the `OE_` prefix. The dialect is proved by an AST walk
  over every module under `src/` that fails on any bare `throw` or leftover
  `TypeError`, plus a duplicate/off-namespace catalogue check.
- **Element — the emitted module is type-checked at build time (#1386)**:
  the compiler emits the compiled module as TypeScript text and the bundler
  lowers it, but nothing checked that text, so a compiler change could emit a
  program that fails `deno check` or a consumer's `tsgo` run and the first
  evidence was a consumer's build. `typeCheckEmittedModule()` compiles the
  emitted text as a real program and returns a checker's diagnostics for it;
  the Vite adapter gains an opt-in `typeCheckEmitted` build gate (off by
  default, because it runs a program per emitted module — a dev-server
  transform must not pay that). It is a pure function of its inputs and only
  reports diagnostics belonging to the emitted files, so a caller's incomplete
  resolution map cannot masquerade as an emitted-module defect.
- **Element — claim-vs-fresh is decided from content, not a child count
  (#1381)**: the kernel chose claim by `root.childNodes.length > 0`, so a
  compiled light-root element carrying a whitespace-only text node — the shape
  an HTML formatter or a parsed file produces — threw `PartProgramClaimError`
  on upgrade for a node that is invisible in the rendered page. Formatting
  whitespace is now normalized before a fresh mount. The fail-closed direction
  is pinned as hard as the fix, because widening it would be the correctness
  regression: a real element, a serializer anchor comment, visible authored
  text and whitespace preceding real content all still throw the structured,
  catchable mismatch, and a serialized light host still claims in place so
  server node identity survives.
- **Router — navigation state has one owner (#1385)**: the client router's
  three pieces of shared mutable state (the monotonic latest-wins ticket, the
  dedup key of the last browser-landed URL, and the one-shot marker of the
  router's own guard-veto restore) lived across four functions. They now live
  in `internal/router/navigation-state.ts` behind three questions — issue/owns,
  isDuplicateLanding/recordLanding, armRestore/consumeRestore — so cancelled
  pending execution is a side effect of owning intent, never of attempting a
  navigation; a guard veto, a stale ticket, an aborted traversal or a disposal
  all leave the current route's in-flight render alone. The machine is DOM-free,
  so its transitions are pinned without a browser, and the four interaction
  cases that motivated the extraction are pinned in the router suite.
- **Router — browser-shaped action POSTs must present an Origin (#1382)**: the
  generated action POST floor let a `multipart/form-data` or
  `application/x-www-form-urlencoded` body through when it carried neither
  Origin nor Fetch Metadata, because that allowance exists for non-browser
  callers. A browser-shaped body can present the same absent headers, so such a
  body is now rejected with the same 403 and RFC 9457 problem document when it
  also carries browser navigation evidence (`Upgrade-Insecure-Requests: 1`, or
  the `text/html` Accept a form navigation sends). A scripted client sends
  neither marker and is unaffected; `Origin: null` is untouched, since null is
  an origin the browser did send. The residual window is written down rather
  than implied: `Origin: null` without Fetch Metadata, `text/plain` form
  bodies, custom API routes and ambient-auth apps, and the
  `OPEN_ELEMENT_DISABLE_CSRF=1` opt-out, which disables this rule too.
- **Docs — how i18n actually works (#1383)**: `/guide/i18n` (plus its `zh`
  twin) states the boundary that had no page: catalogs are application code.
  It covers the two file conventions — declarative locales resolved through
  `PagePropsContext.locale`, and a loader's file-suffix scheme over the content
  tree — and the three rules that keep them honest (one link helper, never
  infer a locale from a two-letter segment, the default locale stays
  unprefixed). For catalogs it names the boring standards and when each fits
  (ICU MessageFormat for tooling compatibility; paraglide once volume grows),
  both build-time because a static-first framework prerenders its pages. What
  stays out is explicit: no message format, no Accept-Language negotiation, no
  content translation inside the framework.
- **Repo — the docs figures and the release bookkeeping follow the tree**:
  `www#check:doc-figures` pins `comparison.md`/`.zh.md` against a fresh
  measurement of `www/dist`, so this train re-baselines them (one page per
  locale from `/guide/i18n`, plus the runtime growth from the Element error
  dialect: html 64→66, sitemap locs 62→64, manifests 64→66, per-locale pages
  31→32, fragments 62→64, manifest entries 304→314, rail pages 54→56,
  code-block pages 42→44, `island-open-cinematic-scroll` 81,984→85,765 raw and
  25,215→26,855 gzip, `/` payload 217,362→221,626 B). The six version points
  move through `deno task version-bump` rather than by hand, the state machine
  admits `v1.0.0-alpha.4`, and the README, the Site version source and the
  registry-truth constants follow.
- **Tracked, not fixed**: `typeCheckEmitted` is implemented and tested but not
  yet enabled in the Router build CLI
  (`packages/router/src/cli/{build-ssg,build-client}.ts`), because that tree
  belonged to another lane in this run; enabling it there is a follow-up. The
  `#1387` portable-host migration (moving the build-time `Deno.*` calls in
  `packages/router/src/{vite,cli}` and `packages/create/src` to `node:*`, and
  retiring the `existsSync` seam) is still a deferred roadmap item, not part of
  this train — the build-time Deno-host requirement documented in the READMEs
  therefore still stands. The `www/tools/generate-api-reference.ts` config-type
  anchor still points at `OpenElementOptions` (which no longer carries the
  config-file keys); the API reference covers the config surface through
  `/guide/configuration` and the interface snapshot, and re-pointing the anchor
  at `OpenElementUserConfig` is a follow-up.

## 1.0.0-alpha.3

**Door-handle train: the surfaces a consumer actually touches — the config
file, the packed npm facade, the error vocabulary, the documentation
pipeline, and the shipped bundle — are converged and gated.** The source
line is `1.0.0-alpha.3`; npm publication is a separate, gated step, so
`docs/release/release-state.json` keeps its registry block at the alpha.2
truth until the post-publish sync. **No migration steps**: the config file is
an optional overlay and nothing here is a breaking change, so an alpha.2
consumer upgrades with no action.

- **Element, Router — framework options get one home (#1411)**:
  `openelement.config.ts` is optional and near-empty; with an empty object
  every option comes from a file convention — design tokens from
  `app/styles/tokens.css`, the application shell from
  `app/islands/app-shell.tsx`, site title from `package.json`. A non-empty
  config file next to inline `openElement(...)` options is a hard error
  ("framework options have two homes"), and an unknown or wrong-typed key
  throws with the accepted-key list; there is no silent merging. The starter
  template's `vite.config.ts` is now `plugins: [...openElement()]` with zero
  CSS strings, `<app-shell>` is registered by convention and stays
  deletable, favicon and og tags reach the built document, and the first
  `deno task dev` run no longer prints the production CORS advisory. The
  documented consumer scaffold command is the short all-permissions form the
  owner ruled on 2026-09-21 (the full command, with its concrete dist-tag,
  lives in the create README and the getting-started guide), admitted as an
  exact path-and-line exemption in the `check-no-allow-all` tripwire while
  every first-party invocation stays scoped.
- **Release — packed npm facade (#1412)**: per-package `keywords`, `engines`
  (node `>=24`; deno `>=2.9` on the two Deno-driven toolchains) and
  `sideEffects` (`false` for element/router/ui, `['./src/cli.js']` for
  create) are written from one source and re-read from the real tarball
  bytes by the new `pack-surface:check` gate, which also fails closed on a
  repository path or ADR citation in shipped text, on an export subpath the
  shipped README never names, and on a module-scope global write in a
  package declared `sideEffects: false`. Every Element facade subpath is
  documented in the package README — the eight that existed when this landed,
  plus `client-only` below; 54 shipped files lost their
  repository-internal references; the create README states the current "do
  not run the bin under npx" limitation (the Node entry is tracked by
  #1387).
- **Element, Router — error experience (#1413)**: the compiler hands the
  build a structured diagnostic (`{id, loc, frame, message, diagnostics}`)
  instead of a pre-joined display string, so an overlay can underline the
  authored line and a consumer can read the location without parsing the
  message apart. The three user-facing runtime failures name the compiled
  module, the tag and the authored `this.<property>` instead of an index the
  author cannot map back; router authoring throws carry stable codes with
  phase and severity plus the remediation sentence they were missing; the
  `start` CLI prints one actionable line built from the message and cause
  chain, with `--debug` expanding the full stack. `/errors` is a derived
  artifact — every `fail(…, 'OEC9xxx', …)` literal plus the element error
  protocol and router code maps — and **38 codes** render per locale from
  the source that raises them; a hand-written list fails `check:errors`.
- **Docs — pipeline before content (#1414)**: five pipeline pieces landed
  first, so the facts are rendered rather than retyped. The API reference
  renders each export's declared signature and its option-bag members; an
  undocumented public export is red, and all **51 empty summaries are now
  documented at their declarations**; the config option table is generated
  from the application options type; `/errors` is generated from the
  definitions; and the install command has one owner
  (`packages/create/src/install-command.ts`) which the site interpolates and
  `starter-smoke` asserts against the packed CLI's own output. Content
  followed the pipeline: the routing-and-data Metadata and Data boundary
  sections are written out, `delegatesFocus`/`formAssociated`/`converter`
  are documented on core-concepts, and getting-started's Build section is
  user-facing.
- **Repo — legacy cleanup (#1415)**: `deno task version-bump <version>` owns
  all six version points — 4× package `deno.json`, `CREATE_VERSION`, and the
  four fixture `deno.lock` files — with a dry run by default and `--write`
  applying the edits, regenerating the locks, and then failing closed unless
  all six agree; hand-editing them burned two alpha.2 release rounds. A
  `workflow_run` companion re-runs the FAILED jobs of AutoFlow CI exactly
  once (attempt 1 only), because webkit fails deterministically per runner
  and only a fresh machine can change the outcome (#1409). A
  workspace-alias-hijack guard refuses to alias `@openelement/*` onto a
  checkout's sources when an app is scaffolded inside a framework clone — a
  build that would otherwise report success while resolving a different
  framework version (#1371 family). The `evidence/` directory (0.43.3
  tarballs) is gone and its ignore rule is documented as staying; the
  per-fixture Nitro rules collapsed to `**/.output*|.wrangler|.nitro`; and
  the ten fixture and e2e directories that had no README have one.
- **Element — bundle and update cost (#1416)**: `@openelement/element/client-only`
  is a fresh-DOM entry without the existing-DOM claim executor, and the
  Router selects it only when no island on a page can hydrate server DOM
  (an island that says nothing keeps the full entry, because guessing the
  other way breaks hydration). Measured on the JFB keyed-table harness:
  **77,557 B → 68,630 B, −8,927 B (−11.5%)**, with the claim diagnostic
  strings at grep count 0 in the final bundle. Keyed updates also skip the
  slot walk when an entry's item reference is unchanged, turn the
  created-entry lookup into a Set, and resolve the fallback insertion
  reference on demand: instrumented on `05_swap1k`, `updateItemValues`
  calls drop from **1000 to 0** per swap and the synchronous segment from
  3.0 ms to 2.7 ms median (−10%, 480 samples).
- **Honest measurement — the swap1k target was not met**: swap1k did **not**
  reach single digits, and this section records why rather than restating the
  goal. On the same runs the afterframe protocol floor (one
  `requestAnimationFrame` plus one `MessageChannel` task with no DOM work at
  all) measured **~13–15 ms** — 15.2 ms baseline against 14.5 ms with the
  change, and ~12.8 ms median in the separately documented floor
  measurement — while `moveEntries`' 997 real `insertBefore` calls cost
  ~2.3–2.7 ms. `moveEntries` is unchanged byte for byte (Svelte's algorithm,
  ruled out of scope for this train), so the reported total contains the
  protocol floor plus that walk. The reactive boundary this exposes is
  documented in both locales on core-concepts: mutating an item in place is
  outside the contract — the same reference comparison a `signal()` holding
  an object draws — and the supported shape is a new item or a new array.
- **Tracked, not fixed**: the packed-starter browser matrix runs behind
  `OPEN_ELEMENT_SKIP_BROWSER_MATRIX=1` (#1425). It fails 3/3 browsers with a
  `waitForFunction` timeout in the consumer harness while the identical
  probe against a manually scaffolded packed starter passes all three
  browsers. The rest of packed qualification stays required; the guard is to
  be deleted when the investigation closes, not carried forward.

## 1.0.0-alpha.2

**Constitutional-enforcement train: the alpha.1 review's fail-closed and
single-source findings are fixed, and the compiled `when` grammar grows to
the full admitted set.** Published to npm as `1.0.0-alpha.2` under the
`@alpha` dist-tag.

- **Element — conditional grammar (#1372)**: `when` regions accept `>`, `>=`,
  `<`, `<=` against a finite numeric literal; strict `===`/`!==` against
  number, string, or boolean literals (no cross-type coercion — `1` never
  matches `"1"`); and bare `this.<property>` truthiness with negation.
  Ternaries were already two-branch regions and now compose with the widened
  operators. All three executors evaluate conditions through one shared
  module (`condition-holds.ts`); the operator/literal space is closed by one
  predicate shared by both wire validators; the convergence guard pins the
  new invariant. The showcase island re-baseline is recorded honestly
  (78,176 → 79,199 raw bytes, +1.31%).
- **Element — security (#1373)**: `meta.tags` attribute names are validated
  against the canonical `isSafeAttributeName` and fail the render closed
  (`UNSAFE_META_ATTR_NAME`); CMS-fed metadata can no longer smuggle
  attribute injection through name grammar.
- **Element — correctness (#1374, #1375)**: the each-region item-key
  derivation is one shared typed function (number `1` and string `"1"` keep
  distinct identity from SSR through claim); runtime update-phase errors
  route into the kernel error boundary instead of escaping into the signal
  writer's stack, with retain-and-retry isolation semantics.
- **Tooling (#1376, #1377, #1378)**: `deno task verify` is gate:ci-equivalent
  and pinned by a contract test; local agent-workspace directories are
  ignored and git hooks are a documented setup prerequisite; the Router
  npm README states the build-time Deno-host requirement for `./vite` and
  `./cli/*`.
- **Site (#1379, #1380)**: the roadmap publish-state derives from
  `release-state.json` (P6); the README comparison's Fresh row states the
  niche argument with dated stall facts.
- **CI hygiene (#1400, interim #1402)**: doc-figures chunk-raw rows carry the
  ±1% cross-runner tolerance; site-e2e retries a single flake per test.
  Investigations open: doc-figures determinism (#1401), job timeouts and
  flake management (#1402), content-dates pre-push hook (#1405).

## 1.0.0-alpha.1

**New repository baseline for Element and Router, published to npm as
`1.0.0-alpha.1` under the `@alpha` dist-tag (npm `latest` stays on the
stable 0.43 line).** This is not an
upgrade of the 0.x
lines and no migration path from 0.x is offered: new projects start from
`@openelement/create`.

- **Packages**: exactly four public packages — `@openelement/element`,
  `@openelement/router`, `@openelement/create`, and the experimental
  `@openelement/ui`. `@openelement/app` and `@openelement/adapter-vite` are
  retired; their responsibilities now live in Element and Router tooling
  subpaths.
- **Element**: one mandatory compiler lowers supported TSX into a Part Program;
  `OpenElement` subclasses are authored with the `@element` decorator and
  `@property` state. Server serialization, fresh DOM, and existing-DOM claim
  all consume the same compiled artifact. Element installs without Router.
- **Router**: Route Mode (explicit route records) and Framework Mode (file
  routes, loaders/actions/forms, SSR/SSG, Vite integration, Nitro mount) ship
  from `@openelement/router`, `./vite`, `./nitro-mount`, and `./cli/*`. Route
  Mode installs without Element. The unimplemented client-side
  `RouteConfig.loader`/`action` fields and the public `SpaLoader*`/`SpaAction*`
  types are removed: the client router never ran them, so the public API no
  longer promises it. Data fetching stays on the route modules' server
  `loader`/`action`.
- **Breaks from 0.x**: package names and import paths changed with the new
  baseline; `@openelement/element/sanitize` is gone and `trustedHtml` is the
  trust boundary; raw head fragments are passed through verbatim with only
  fail-closed invariants (`<script>` and executable `<style>` rejected);
  served `Content-Type` values derive from the maintained `mime` package; runtimes without the
  Web Standard `URLPattern` fail fast; the generated standalone
  `dist/server/serve.mjs` is replaced by the portable
  `fetch(Request) -> Response` entry plus the start CLI; the ADR-0120 hard
  rule "pages with actions cannot be prerendered" is repealed — a page may be
  hybrid: prerendered static GET plus a request-time action POST, with
  `dist/server/` emitted whenever any route has an action (ADR-0120
  amendment, 2026-09-16).
- **Install (Alpha)**:

  ```bash
  deno run --allow-read --allow-write --allow-env --allow-net --deny-ffi --no-prompt --minimum-dependency-age 0 npm:@openelement/create@alpha my-app
  ```

  `@alpha` tracks the 1.0 prerelease line; a versionless install resolves the
  stable 0.43 line. Deno 2.9+ is required.
- **Known limitations**: Alpha APIs may still change. `@openelement/ui` is
  experimental and outside the stable API promise. Hosted/deployed SaaS
  qualification, production SMTP, and real scan-engine qualification are
  external pending.

### Review-round corrections (post-baseline, this branch)

- **Correctness**: the reading-page heading-id allocator now probes for the
  first free suffix against every id already in the document (a page with an
  element `id="foo-2"` plus two `Foo` headings no longer emits a duplicate
  DOM id); RSS `pubDate` validation is a UTC calendar round-trip, so
  impossible dates (`2026-02-29`, `2026-04-31`) fail closed instead of being
  silently normalized by `Date`.
- **Public API (Router)**: `head.structuredData` entries and values are typed
  as a recursive `JsonValue` (`StructuredDataEntry = { readonly [key: string]:
  JsonValue }`) instead of `Record<string, unknown>`; `JsonValue` is exported.
  Runtime validation is unchanged.
- **Public API (UI)**: `openPropsRootSheet` and the `toRootCss` transform are
  removed. The remaining `openPropsTokenSheet` token block selects
  `:root, :host`, so one generated sheet serves document and shadow
  adoption; the structural fallback stays `:host`-only.
- **Build**: the production Site build is hermetic — source dates come from
  the committed `www/lib/content-dates.json` manifest and the retired-URL
  baseline from `www/tools/site-baseline-routes.json`, so `site:build` needs
  no network, no remote and no `.git`. Git-based refresh/verify tasks
  (`content-dates:*`, `retired-url:check --refresh`) run in CI, not in the
  build.
- **Release**: `@openelement/ui` now ships `THIRD_PARTY_NOTICES.md` inside
  its tarball (open-props MIT text), asserted by the packed-artifact gate.
- **Tokens**: the open-props adapter lives at
  `packages/ui/tools/generate-ui-tokens.ts` (task
  `deno task --cwd packages/ui generate:ui-tokens`); build-artifact emitters
  are named `emit-*` and no longer fake `--check` tasks.

## 0.44.0-beta.1

**First public v0.44 prerelease (dist-tag `beta`; npm `latest` stays on the
stable 0.43 line).** The TSX-to-Part Program compiler and page-route SSR bound
to the compiled program. The 0.41.0-era npm
`beta.1`–`beta.3` artifacts remain withdrawn partial publishes, unrelated to
this line.

## 0.43.3 / 0.43.2 / 0.43.1 / 0.43.0

**Stable maintenance line (npm `latest`).** Compatible bug, security, runtime,
documentation and release-truth patches under ADR-0140 — no 0.44 feature train.

## 0.42.0

**WC light fullstack, stable.** The stable cut of the 0.42 alpha line: the
request-time Application Loop (ADR-0120) frozen on top of the 0.41.x static
freeze (ADR-0119), with freeze scope and non-goals in ADR-0122.

- **Frozen scope (ADR-0122 §1–§4)**: the loop contract (loader/action
  signatures, `fail()`/`redirect()` algebra + HTTP encodings, PRG
  revalidation, no-JS baseline), the action protocol
  (`x-openelement-action`, morph client contract, channel symmetry), the
  fail-closed CSRF same-origin default, and first-mile start semantics.
  Breaking changes to these require an amendment ADR.
- **Breaking changes since 0.41.x**: `IslandOptions.strategy` renamed to
  `hydrate` with no alias (ADR-0127); shape-1 SSR markup gains one fallback-tag
  wrapper element (ADR-0128); head-injection tightening — `<base>` /
  `<meta http-equiv>` / raw `<script>` rejected in `headExtras`; unfrozen alpha
  exports removed (`i18nStaticPaths`, `switchLocale`, `AppIslandOptions`,
  `OPEN_PROPS_TOKEN_CSS`, the `OpenElementRouteNode` re-export); pure-static
  builds no longer emit `dist/server/`; minimum Deno version is 2.8.
- **Not frozen / not claimed**: session/flash, cache/ISR (`revalidate` stays
  inert forward-compat data), streaming SSR, performance SLOs, third-party WC
  SSR corpus, production runtime recovery.

## 0.42.0-alpha.17

Registration-decoupling train (ADR-0128): route modules whose default export is
`definePage(...)` register the page class under the route-path-derived fallback
tag; `export const tagName` on a definePage route only names a content element.
Shape-1 pages gain the fallback-tag page element as an outer DSD wrapper around
the content element; user CSS targeting the old root tag must target the new
fallback tag or the content element. Plain element routes keep their `tagName`
export as the registration tag.

## 0.42.0-alpha.16

Starter-first remediation train.

- **Island runtime**: `hydrate: 'only'` islands bind events and signals instead
  of rendering inert; function-mode `defineIsland` islands re-render on signal
  change.
- **Routing/SSR**: `notFound()` from a page render propagates to a real 404;
  unmatched request-time paths render the styled 404 page with
  `Cache-Control: no-store`; successful GET pages relax to
  `private, no-cache` while POST responses keep `no-store`.
- **element runtime**: `<style>`/`<script>` text children serialize as raw
  text; `data:` URIs are allowed on `img src` only; keyed `For` semantics
  locked and its teardown leak fixed.
- **Breaking (unfrozen alpha surface)**: head-injection sanitization tightened
  (`<base>` and `<meta http-equiv=...>` stripped from `headExtras`/head
  fragments); `IslandOptions.strategy` renamed to `hydrate` with no alias
  (ADR-0127).
- **CSRF and enhanced forms**: cross-site POSTs rejected while same-origin
  native form posts pass; enhanced forms morph correctly into slotted
  light-DOM pages.
- **Starter surface**: working blog routes, pinned dev vite version, styled 404
  route.

## 0.42.0-alpha.15

Backlog-zero train: the element runtime gains a built-in allow-list HTML
sanitizer `sanitizeHtml` (later removed in the 1.0 baseline in favor of the
`trustedHtml` boundary) and keyed `<For each key>` reconciliation via an
optional `key` prop (ADR-0124), with displaced entries disposed on duplicate
keys. URL safety decoding tightened and `_blank` links get `rel` neutralized.
The SPA router gains a URLPattern fallback for Firefox, and framework throws
converge on `OpenElementError`.

## 0.42.0-alpha.14

Simplification and consumer-packaging train: packed-package consumers of JSR
dependencies unblocked; client runtimes are bundled via virtual modules; jsonc
parsing delegated to `@std/jsonc`; no-skip version continuity in release
tooling.

## 0.42.0-alpha.13

Standards-as-seams train (ADR-0123).

- **Morph robustness**: the enhance/island client is a real tested module;
  focus, scroll and form-control state survive enhanced updates; nested DSD
  templates instantiate recursively; `open:ready` fires for every strategy
  bucket.
- **Route standards**: all route matching is WHATWG URLPattern — the SPA client
  router and the generated server matcher share one semantics;
  `renderIntent.mode` is `'static' | 'dynamic'` with the `'auto'` alias
  removed.
- **Server seams**: a WinterCG-shaped fetch middleware contract runs identically
  in dev, `start`, fixtures and Nitro; `cli/preview` merged into
  `cli/start --mode=preview`.
- **Protocol**: fetch-channel error responses are RFC 9457
  `application/problem+json`, including the CSRF 403.
- **Components**: `open-input` becomes a real native-form citizen;
  `open-dropdown` moves to the Popover API with CSS anchor positioning.
- **Site search**: full-text, ranked, bilingual via Pagefind.

## 0.42.0-alpha.12

Maintenance train; no new product surface beyond the fixes.

- **Correctness**: a guard-vetoed `redirect()` from a post-action loader re-run
  no longer wipes page data; the SPA client router matches Hono-style
  `:param{.+}` catch-all patterns; malformed percent-encoded URLs answer 400
  instead of hanging.
- **CSRF floor proven**: the generated action POST same-origin floor has real
  deny/allow coverage, with `OPEN_ELEMENT_DISABLE_CSRF=1` as the documented
  opt-out.
- **Honest claims**: ISR labelled forward-compat/inert wherever it appears; the
  security guide documents the built-in CSRF floor; the starter `headerNav`
  config renders.

## 0.42.0-alpha.11

Maintenance train.

- **Security**: `validateSafeUrl` tab/newline bypass closed (module-script
  `data:` XSS); desktop examples bind loopback only; the Mastodon example no
  longer caches API errors as data.
- **Correctness**: a guard-vetoed redirect during navigation keeps the current
  page's loader data; `useLoaderData<T>()` types `T | undefined`; theme
  broadcast no longer clobbers host-owned `data-theme`; disconnect→reconnect no
  longer resets non-reflected prop state; JSX callback `ref` is consumed;
  `open-button` anchor-mode disabled sync works both ways; `open-input` /
  `open-badge` observe dynamic attribute changes.
- **Honesty over surface**: the homepage flagship example is real compilable
  API; dead options, config keys and misleading types removed across
  element/app/adapter-vite.

## 0.42.0-alpha.10

Cleanup and hardening train; no new product surface.

- **Runtime correctness**: element `update()` routes re-render errors to
  `onRenderError`; SPA loader failures take the `__openElementError` channel and
  SPA loader/action honor `redirect()`/`notFound()` with real navigation; UI
  double-escaping removed, open-tabs accessibility rewrite with
  instance-unique ARIA ids, open-dialog SSR `open` sync; generated-data writes
  fail closed in build mode; `getStaticPaths` errors honor
  `dynamicRouteFailure: 'fail'`; the start CLI static server shares the test
  fixture and unwraps request-time responses.
- **Breaking (unfrozen alpha surface)**: `@openelement/app` drops
  `i18nStaticPaths`/`switchLocale`/`AppIslandOptions` and the
  `OpenElementRouteNode` re-export; `@openelement/ui/open-props-tokens` no
  longer exports `OPEN_PROPS_TOKEN_CSS`; the generated ui manifest corrects
  open-tabs slots to `['tab','panel']`. `@openelement/element` gains
  `@experimental` exports: ISR cache types and the third-party client runtime
  `hydrateOpenElement`/`disposeOpenElement`.

## 0.42.0-alpha.9

Cleanup train; no new product surface. `<open-button>` binds its click handler
so shadow-DOM submit events reach the outer form; request-scoped context is
passed explicitly through render/hydrate entry points.

## 0.42.0-alpha.8

**Incomplete release (npm-unpublished).** Tagged as a mechanical version bump,
but the packages were never published; superseded immediately by
`0.42.0-alpha.9`.

## 0.42.0-alpha.7

Patch release; all five packages published to npm under the `alpha` dist-tag
(historical five-package line).

## 0.42.0-alpha.6

Second independent review of the application loop.

- **Morph client correctness**: an explicit `<form action>` wins over the page
  URL on enhanced submits; the popstate guard survives reloads and bfcache
  restores; morphed-in islands show the server render; morph matching is an
  ordered walk with exact deletion and relocation; nested DSD compares
  normalized on both sides; forms inside late-hydrating islands get the
  enhancement listener; a cancelable `open:action-error` hook precedes the
  network-failure reload.
- **Detection**: `hasEnhancedForms` follows relative imports.
- **Protocol tail**: malformed form bodies answer 400 on both channels; the
  redirect duck type honors the 3xx whitelist; 405 responses carry
  no-store/Vary.

## 0.42.0-alpha.5

First hardening pass on the 0.42 line (ADR-0121).

- **Root cause**: the alpha.3 morph enhancement never fired because `submit` is
  not composed and page content lives inside page-element DSD shadow roots.
  The client is rewritten around shadow-root submit interception and
  shadow-content morphing; island-survival claims are mechanically true.
- **Protocol (ADR-0121)**: named-action dispatch is own-key gated; one
  `x-openelement-action` header (`true` = ActionResult JSON, `enhance` = HTML
  morph) with `Vary`; an action returning a `Response` is a contract violation;
  the default PRG strips the `?/name` marker; every 3xx coerces to 303 on POST
  and `redirect()` validates its status; fetch callers always receive
  ActionResult JSON; request-time responses carry `Cache-Control: no-store`;
  action POSTs get a 10 MB body limit; non-GET/POST methods answer 405.
- **Morph continuity**: form-scoped `data-open-region` targeting with
  navigation fallback, id-keyed + lookahead identity matching, popstate reload,
  cancelable `open:action-failure`, submitter name/value preserved, 500 /
  cross-origin responses navigate instead of morphing, double-submit guard,
  fragment preservation, `<details>`/media state protection.
- **Also fixed**: dev SSR crash on every route; `[...path]` request-time
  routes; zero-island apps with enhanced forms; the starter's `/contact` route
  now builds and is POST-smoked.

## 0.42.0-alpha.4

Hardening and recipes (ADR-0120).

- Validation recipes verified in tests: zod (`/register`) and valibot
  (`/subscribe`) run inside fixture actions with 422/303 asserted in three
  engines. better-auth and Drizzle recipes are published as doc-level,
  honestly marked unverified.
- The `create` starter gains a request-time `/contact` route exercising the
  full loop (`rendering: 'dynamic'` + action + `data-open-enhance`).
- Fix from alpha.3: the morph no longer replaces an island whose light DOM
  carries whitespace-only text around the DSD template.

## 0.42.0-alpha.3

Revalidation continuity (ADR-0120): enhanced forms (`data-open-enhance`) morph
the returned document into place instead of reloading — submission returns the
same HTML the no-JS path renders (303/422), the client morphs it, and
`history.pushState` follows the PRG target. A hydrated island whose light-DOM
surface is unchanged keeps its shadow state; `data-open-preserve` exempts any
subtree; the island client script is never re-executed by a morph. A
`data-open-region` container limits the morph to the matching region.

## 0.42.0-alpha.2

The form/action loop (ADR-0120): plain HTML forms work without JavaScript on
`rendering: 'dynamic'` routes. Actions run before loaders; `fail(4xx, data)`
returns take the 422 re-render channel with the echo; successful mutations
answer 303 (PRG); redirects thrown from actions coerce to 303; POST without an
action is a defined 404. Named actions dispatch via `formaction='?/name'`;
unknown names are a defined 404. Fetch callers receive the `ActionResult`
discriminated union.

## 0.42.0-alpha.1

First alpha of the 0.42 line (ADR-0120): request-time rendering gains
semantics. `rendering: 'dynamic'` routes skip prerendering and are served per
request by the generated `dist/server/index.js`, with
`dist/server/server-manifest.json` recording the partition. Hard rule: pages
with actions cannot be prerendered — a route module exporting an action without
`mode: 'dynamic'` fails the build (repealed by the ADR-0120 amendment of
2026-09-16: hybrid static GET + request-time POST is now allowed). Pure-static
projects emit no new artifacts.

## 0.41.2 / 0.41.1

Patch releases: release-tooling hardening and hygiene only — no public API,
topology or runtime-default changes.

## 0.41.0

Stable five-package release (ADR-0119; historical line): the interface freeze
covers `defineElement`, `definePage`, `buildApp`, the package graph, the
supported subpaths and the static/SPA semantics of `defineApp`; request-time
data, forms, sessions and cache stay explicitly unfrozen until 0.42/0.44.

- **Breaking**: adapter-vite internal subpaths pruned at the freeze
  (`app-vite`, `build-context`, `head-injection`, `i18n-plugin`, `plugin`,
  `generated-data-resolver`, `plugin-mdx`, `route-manifest`,
  `cli/build-client`, `cli/build-ssg`) — use the root, `nitro-mount`,
  `cli/build` and `sitemap` instead.
- ui control geometry is squared (`--btn-radius`, `--badge-radius`,
  `--ui-control-radius`: `--radius-round` → `--radius-1`, 6px) — visual
  breaking change; update screenshots and custom control CSS.
- The release verifier now supports stable `x.y.z` versions, and the version
  guards stay honest on a stable current line.

## 0.41.0-alpha.19

Cleanup sweep; no new product surface. Fixes the reflect
removal suppression (Boolean `default: true` desync), the popstate
redirect-then-block URL fork, and For drift-token separator collisions.
Breaking type-surface changes: the element root switches to explicit type
export lists, `SafeHtml`/`UnsafeHtml`/`StyleSheetRule` leave the root, and the
internal `open-element-render`/`open-element-hydration` subpaths are pruned
from element exports.

## 0.41.0-alpha.18

Fixes the `reflect: true` static-prop write loop and SSR attribute overwrite;
resolves the root-level `<Show>`/`<For>` CSR edge; unifies prop attribute
casing; makes `For` branch tokens content-sensitive; fixes client-runtime
double hydration; runs router guards on history traversal; honors
`prefers-color-scheme` in theme-init. Dynamic-route render failures now fail the
build (opt-out `'warn'`). Breaking removals of dead exports, fields and scripts.

## 0.41.0-alpha.17

Covers hydration and binding behavior in a real browser: signal text patching,
event hydration, SSR/hydration mismatch fallback and form submission through
shadow boundaries. A failing route render produces a defined 500 result with
`RenderError` diagnostics. Breaking surface removals: element root build
utilities (migrate to `@openelement/element/build-utils`), app root
`RouteConfig`/`RouterInstance`/`RouterMode` types, adapter-vite
`ExternalManifest` type and `SsgPageOutput.hydrationHints`.

## 0.41.0-alpha.16

Fixes unknown dynamic-route params serving 200: a `notFound()` thrown from a
page element's render propagates through the DSD render chain as protocol
control flow so the request-time server entry answers 404. SSR and hydration
event markers align for custom-element hosts and `Show`/`For` branches;
hydration validates marker counts and branch tokens and falls back to client
re-render on mismatch. Static-props `observedAttributes` merge at
class-definition time. Windows drive-letter island paths normalized.

## 0.41.0-alpha.14

Recovers the release line with an exact-version starter and verified published
consumers; all five packages published under the `alpha` dist-tag (historical
five-package line) with post-publish Deno, Node ESM, Nitro and third-party Web
Component smoke coverage.

## 0.41.0-alpha.13

Publication failed; changes shipped in alpha.14.

- Removes the alpha-only `defineLayout` alias; use `defineElement` with the
  same arguments for layout elements.
- Restores declared static-prop defaults when reflected attributes are removed.
- Hardens SSR prop injection, custom-element hydration, params parsing, nested
  SSR depth, and adopted stylesheet composition.
- Stabilizes SPA action errors, caches same-route GET requests, bounds render
  data contexts, and compiles client routes into a declaration-ordered trie.
- Moves UI tokens to a CSS source of truth with generated-output drift checks;
  Create template generation becomes asynchronous, deterministic, and bound to
  the same-version release invariant.

## 0.41.0-alpha.12

Audit-remediation foundation release.

- Fixes core runtime issues, including the `signal-context` infinite loop and
  `ErrorBoundary` retry.
- Hardens SSG/build: command-injection closure, dynamic-route encoding, and
  pure-Node `process.cwd()` compatibility.

## 0.41.0-alpha.11

- Restores frozen-install and changed-path workflow truth.
- Fixes query decoding, SPA page-host data, dialog inert restoration, and theme
  propagation.
- Consolidates the Element/Adapter protocol seam and removes verified dead DSD,
  CEM, route-scanner, and UI escape code.
- Repairs clean Nitro Workers builds, semantic visual smoke, and package
  artifact allowlists.
