# Changelog

All notable user-visible changes are recorded here, newest first. This is an
aggregated historical archive, not a release-by-release record; details for
individual versions are recoverable from Git history. Current product truth
lives in:

- [`docs/architecture/product-model.md`](./docs/architecture/product-model.md)
- [`docs/release/release-state.json`](./docs/release/release-state.json)
- [`docs/release/public-interface-snapshot.json`](./docs/release/public-interface-snapshot.json)

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
