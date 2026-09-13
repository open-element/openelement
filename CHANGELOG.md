# Changelog

> **Historical archive.** The maintained, per-release record lives in
> [`docs/release/`](./docs/release/) and is the authoritative source. This file
> is an aggregated history only: it is **not re-synchronized release by
> release** and there is no mechanism keeping it in lockstep with
> `docs/release/`. When the two disagree, `docs/release/` wins.

Current truth lives in:

- [`docs/architecture/product-model.md`](./docs/architecture/product-model.md)
- [`docs/release/release-state.json`](./docs/release/release-state.json)
- [`docs/release/public-interface-snapshot.json`](./docs/release/public-interface-snapshot.json)

Historical changelog details remain available through git history and release
evidence.

## 0.44.0-beta.1

**First public v0.44 prerelease (dist-tag `beta`; npm `latest` stays on the
stable 0.43 line).** Framework qualification under a frozen governance
envelope (ADR-0151): the TSX-to-Part Program compiler, page-route SSR bound
to the compiled program, and the delivery gates. The authoritative note is
`docs/release/v0.44.0-beta.1.md` (historical; see git history); the
0.41.0-era npm `beta.1`–`beta.3` artifacts remain withdrawn partial
publishes, unrelated to this line.

## 0.43.3 / 0.43.2 / 0.43.1 / 0.43.0

**Stable maintenance line (npm `latest`).** Compatible bug, security,
runtime, documentation and release-truth patches under ADR-0140 — no 0.44
feature train. Per-release notes:
`docs/release/v0.43.0.md` (historical; see git history),
`v0.43.1`, `v0.43.2`,
`v0.43.3`.

## 0.42.0

**WC light fullstack, stable.** The stable cut of the 0.42 alpha line — the
request-time Application Loop (ADR-0120) frozen on top of the untouched
0.41.x static freeze (ADR-0119), with freeze scope and non-goals in ADR-0122
(accepted 2026-08-14, TP-6). See the per-alpha entries below for the full
train history; `docs/release/v0.42.0.md` is the authoritative note and
`docs/release/v0.42.0-migration.md` the upgrade guide.

- **Frozen scope (ADR-0122 §1–§4)**: the loop contract (loader/action
  signatures, `fail()`/`redirect()` algebra + HTTP encodings, PRG
  revalidation, no-JS baseline), the action protocol
  (`x-openelement-action`, morph client contract, channel symmetry), the
  fail-closed CSRF same-origin default, and first-mile start semantics.
  Breaking changes to these require an amendment ADR.
- **Breaking changes since 0.41.x**: `IslandOptions.strategy` renamed to
  `hydrate` with no alias (ADR-0127); shape-1 SSR markup gains one
  fallback-tag wrapper element (#960, ADR-0128); head-injection tightening —
  `<base>` / `<meta http-equiv>` / raw `<script>` rejected in `headExtras`
  (#931); unfrozen alpha exports removed (`i18nStaticPaths`, `switchLocale`,
  `AppIslandOptions`, `OPEN_PROPS_TOKEN_CSS`, the `OpenElementRouteNode`
  re-export); pure-static builds no longer emit `dist/server/` (#953);
  minimum Deno version is 2.8 (the generated `dist/server` requires Node ≥
  20.19 or Node 24 — the stale Node 18+ claim is tracked as #969).
- **Upgrade**: pure-static and SPA projects need zero source changes — bump
  the five `@openelement/*` specifiers to `0.42.0`, refresh the lockfile,
  rebuild (byte-level upgrade proof in the release note).
- **Not frozen / not claimed**: session/flash, cache/ISR (`revalidate` stays
  inert forward-compat data), streaming SSR, performance SLOs, third-party
  WC SSR corpus (0.43), production runtime recovery (0.44).

## 0.42.0-alpha.17

Registration-decoupling train (#960, ADR-0128) plus the architect final
review's hardening and documentation set.

- **Breaking (SSR markup, ADR-0128)**: route modules whose default export is
  `definePage(...)` now register the page class under the route-path-derived
  fallback tag (`app/routes/index.tsx` → `index-page`); the
  `export const tagName` on a definePage route is ignored for registration
  and only names a content element (#960). Shape-1 pages (starter pattern)
  gain the fallback-tag page element as an outer DSD wrapper around the
  content element; hydration markers and morph behavior are unchanged, but
  user CSS targeting the old root tag must target the new fallback tag or
  the content element. Plain element routes (no definePage) keep their
  `tagName` export as the registration tag. Fixes the silent loss of the
  definePage render when a module self-registered a content element under
  the same tag. Migration: `docs/release/v0.42.0-migration.md`.

## 0.42.0-alpha.16

Starter-first remediation train (issues #915–#959): the remaining
headline gaps from the round-3 audit close, with e2e gates pinning each fix.

- **Island runtime**: `hydrate: 'only'` islands now bind events and signals
  instead of rendering inert (#939); function-mode `defineIsland` islands
  re-render on signal change (#940).
- **Routing/SSR semantics**: `notFound()` from a page render propagates to a
  real 404 status (#922); unmatched request-time paths render the styled 404
  page with `Cache-Control: no-store` (#923). Successful GET pages relax from
  `no-store` to `private, no-cache` so the UA can restore scroll position and
  use bfcache (#943); POST responses keep `no-store`.
- **element runtime**: `<style>`/`<script>` text children serialize as raw
  text — CSS selectors with `>` no longer corrupt (#932); `data:` URIs are
  allowed on `img src` only, not `href` (#929); keyed `For` semantics locked
  (a data change without a key change does not re-render, #915), its
  AbortSignal teardown leak fixed (#916), and the coverage matrix landed
  (#918).
- **Breaking (unfrozen alpha surface)**: head-injection sanitization is
  tightened — `<base>` and `<meta http-equiv=...>` are now stripped from
  `headExtras`/head fragments (#931). Apps injecting a CSP meta or base tag
  through `headExtras` must move those into the document shell / SSG
  postprocess directly.
- **Breaking (alpha surface, ADR-0127)**: element's `IslandOptions.strategy`
  is renamed to `hydrate` (#920), matching the app-side
  `defineIslandConfig({ hydrate })` name; the old name is deleted with no
  alias. Migration: rename `strategy` → `hydrate` at each element
  `defineIsland()` call site. App-side authoring is unaffected.
- **Starter surface**: the dev task pins the same vite version as the import
  map (#927); the template ships working blog routes (`content/blog`,
  `@openelement/generated/blog-data`, styled 404 `app/routes/404.tsx`) — a
  copyable example for the documented virtual module and the shadow-DOM
  styling constraint.
- **CSRF and enhanced forms**: request-time mutation endpoints enforce a
  coherent Origin policy matrix — cross-site POSTs are rejected while
  same-origin native form posts (`Origin: null` + `Sec-Fetch-Site:
  same-origin`) pass (#921, #938); enhanced forms morph correctly into
  slotted light-DOM pages (#937).
- **keyed For hydration**: matched DSD hydration keeps keyed `For` lists
  reactive — per-item boundary markers pair hydrated list groups with their
  `For` target by branch ordinal (#917).
- **ErrorBoundary**: render failures inside a subtree are auto-captured by
  the nearest `ErrorBoundary` (ADR-0053 Layer 2) and bubble outward when a
  fallback itself throws (#919); a subclass `render()` must branch on
  `hasError` (#958).
- **Pre-hydration clicks**: clicks landing between first paint and island
  hydration are captured and replayed once when the island hydrates (#942).
  Capture starts when the generated client entry executes — clicks that
  land before the client script loads are still lost; replayed events carry
  `isTrusted=false` and native default actions (anchors, checkboxes) may
  run twice.
- **Dev chain**: dev serves the island client entry and injects its script
  tag (#951); dev SSR re-definition overwrites stale classes in the
  customElements stub (#952).
- **Build output**: pure-static dist drops the build-time SSR bundle
  (#953); `.mdx` route files are discovered and rendered (#954); index
  routes keep clean URLs when a same-named sibling directory exists (#956);
  request-time builds emit a standalone `dist/server/serve.mjs` entry
  (#959); the `corsOrigin` misconfiguration warning is emitted once per
  process (#925).
- **Docs**: minimum Deno version declared and the markdown post-title H1
  rule documented (#928, #935).
- **Further fixes in this train**: unserializable island props degrade like
  a `render()` failure instead of crashing SSR; the depth-limit error is
  logged once, not once per bubbled frame; the standalone `serve.mjs`
  validates `PORT`/`OPEN_ELEMENT_PORT`; the dev island client entry matches
  URLs with query strings; the missing-`tagName` scanner note is silenced
  for definePage routes; the SSR instantiate-failure fallback now preserves
  attributes like the render-failure fallback (#892 partial); `target="_blank"`
  case variants get a forced `noopener`; CSS escapes/comments are folded
  before the style blocklist check; event-binding disposers register under
  signal lifecycles; keyed `For` rewinds its insertion cursor on duplicate-key
  displacement.

## 0.42.0-alpha.15

Backlog-zero train: built-in HTML sanitization and keyed reconciliation
land in the element runtime, alongside a wide simplification sweep.

- **element runtime**: built-in allow-list HTML sanitizer `sanitizeHtml`
  (#894); keyed `<For each key>` reconciliation via an optional `key` prop
  (ADR-0124, #890), with displaced entries disposed on duplicate keys
  (#911); `isSafeUrl` decodes `&colon;` and `_blank` links get `rel=opener`
  neutralized (#911); guarded `RenderHooks` throw semantics documented
  (#911); the DSD layout-fix flush is chunked across frames (#896); SSR/CSR
  prop collection unified and the `OpenElement` base class split into
  collaborators (#903, #904, #906, #900).
- **Correctness**: SPA router gains a URLPattern fallback for Firefox
  (#897); framework throws converge on `OpenElementError` (#898, #899).
- **Docs truth**: code-claim registry with a claims gate wired into
  `docs:truth` and the AutoFlow gates (#893, #911).
- **Hygiene**: simplification sweep across tools/packages/www (dead exports,
  `release.ts` split, Web/ES/Deno std API convergence, unused import-map
  entries dropped); e2e made network-independent via `host-resolver-rules`.

## 0.42.0-alpha.14

Simplification and consumer-packaging train: the packed-package consumer
path is unblocked and dead surface is swept repo-wide.

- **Consumer packaging**: packed-package consumers of jsr dependencies
  unblocked and the consumer smoke fixed (#886, #887); client runtimes are
  bundled via virtual modules instead of `toString()` (#868); jsonc parsing
  delegated to `@std/jsonc` (#870).
- **Release tooling**: no-skip version continuity and pre-seeded release
  note survival (#869, #855); docs-truth five-in-one registry and consumer
  qualify tiers (#870).
- **Hygiene**: simplify-scan deletion rounds swept dead files, dead exports
  and dead flags (#879–#884); architecture anti-rot quirks ledger (#871).

## 0.42.0-alpha.13

Standards-as-seams train + TP-6 freeze preparation (16 issues: #603–#610,
#856–#860, #863–#867; ADR-0123).

- **Morph robustness (the alpha.7 debt, all of it)**: the enhance/island
  client is a real tested module instead of a 400-line string template
  (#610); focus, scroll and form-control state survive enhanced updates
  (#603); nested DSD templates instantiate recursively (#604); `open:ready`
  fires for every strategy bucket (#605); island scheduling has a single
  owner (#606).
- **Route standards**: all route matching is WHATWG URLPattern — the SPA
  client router and the generated server matcher share one semantics (#856);
  `renderIntent.mode` is honestly `'static' | 'dynamic'` with the `'auto'`
  alias removed (#609).
- **Server seams**: a WinterCG-shaped fetch middleware contract runs
  identically in dev, `start`, fixtures and Nitro (#858); nitro-mount is a
  near pass-through on Nitro v3's native `Request` (#857); `cli/preview`
  merged into `cli/start --mode=preview` (#859).
- **Protocol**: fetch-channel error responses are RFC 9457
  `application/problem+json`, including the CSRF 403 (#863).
- **Components**: `open-input` becomes a real native-form citizen
  (ElementInternals pilot, #864); `open-dropdown` moves to the Popover API
  with CSS anchor positioning (#865).
- **Site search**: full-text, ranked, bilingual via Pagefind (#867).
- **TP-6 preparation**: migration note, zero-cost upgrade proof and ETag
  revalidation design note (#866).

## 0.42.0-alpha.12

Round-6 full-spectrum audit remediation train: all 112 findings from the
2026-08-02 round-6 audit (issues #810–#852) are fixed; the report lives at
`docs/audit/2026-08-02-round6-audit.md`.

- **Correctness**: a guard-vetoed `redirect()` from a post-action loader
  re-run no longer wipes page data — the action path mirrors the #802
  navigation guard (#810); the SPA client router matches Hono-style
  `:param{.+}` catch-all patterns (#812); malformed percent-encoded URLs are
  a defined 400 instead of a hung request (#823).
- **CSRF floor proven**: the generated action POST same-origin floor has
  real deny/allow e2e coverage, with `OPEN_ELEMENT_DISABLE_CSRF=1` as the
  documented opt-out (#811).
- **Honest claims**: ISR labelled forward-compat/inert wherever it appears
  (#840, #842, #843); the security guide documents the built-in CSRF floor
  (#815); the starter `headerNav` config actually renders (#829).
- **Gates that gate**: `verify-package-configs` performs a real version
  check (#824); `stripComments` is string-literal aware (#826); mojibake and
  stale-claim pattern lists single-sourced (#827, #838); the five-package
  roster derived from one constant (#828).
- **Hygiene**: 23 dead SVG icons deleted (#831); the dead blue/teal/cyan
  token palette no longer ships in every page (#832); `data-ssr-props`
  single-sourced (additive `DATA_SSR_PROPS` export, #836); dead exports and
  config swept across all five packages (#833, #834, #845–#852).

## 0.42.0-alpha.11

Round-5 full-spectrum audit remediation train: all 78 findings from the
2026-08-01 round-5 audit (issues #730–#809) are fixed; the report lives at
`docs/audit/2026-08-01-round5-audit.md`.

- **Security**: `validateSafeUrl` tab/newline bypass closed (module-script
  `data:` XSS, #761); desktop examples bind loopback only — the reader's
  LAN-reachable arbitrary file read and remote kill are gone (#777);
  Mastodon example no longer caches API errors as data (#775).
- **Correctness**: a guard-vetoed redirect during navigation keeps the
  current page's loader data (#802); `useLoaderData<T>()` honestly types
  `T | undefined` (#763); theme broadcast no longer clobbers host-owned
  `data-theme` (#773); disconnect→reconnect no longer resets non-reflected
  prop state (#772); JSX callback `ref` is consumed (#756); `open-button`
  anchor-mode disabled sync works both ways (#757); `open-input`/
  `open-badge` observe dynamic attribute changes (#769, #770); blog locale
  fallback direction fixed (#759); three empty-shell site-ui components
  registered (#758); page-rail scroll-spy active state applies (#779).
- **Honesty over surface**: the homepage flagship example is real compilable
  API (#762); dead options, dead config keys and misleading types removed
  across element/app/adapter-vite (#764–#768, #771).
- **Repo hygiene**: `.githooks` executable again so local gates cannot be
  silently skipped (#760); duplicated tools helpers single-sourced; ~40 dead
  exports / dead files swept.

## 0.42.0-alpha.10

- Cleanup and hardening train (milestone #17, 97/97 issues closed): the
  evidence-chain batch (#646–#653), the P1 correctness batch, the P2 batch and
  the P3/P4 hygiene sweep land together. No new product surface; the ADR-0119
  freeze surface and the ADR-0120 Application Loop scope are untouched.
- Release tooling: two-stage publish now requires a durable, gated prepare
  record — publish-existing refuses to run without one (#684, closes the
  alpha.8 version-hole class); the docs stale guard is parameterized off
  `PREVIOUS_PACKAGE_VERSION` so the next bump cannot self-collide (#727);
  `bump-version.ts` documents its half-bump role (#687); the dead JSR publish
  channel is removed (#746).
- Runtime correctness: element `update()` routes re-render errors to
  `onRenderError` (#662); SPA loader failures take the `__openElementError`
  channel (#676) and SPA loader/action honor `redirect()`/`notFound()` with
  real navigation (#731); ui double-escaping removed (#726), open-tabs
  accessibility rewrite (#666) and instance-unique ARIA ids (#745), open-dialog
  SSR `open` sync (#667); generated-data writes fail closed in build mode
  (#671); `getStaticPaths` errors honor `dynamicRouteFailure: 'fail'` (#672);
  the start CLI static server is shared with the CI fixture and its
  request-time response unwrap is fixed (#732); `adapter-vite` declares its
  `typescript` dependency so published consumers resolve (#725).
- Hygiene: element's three internal barrels collapse to one (#739); the dead
  `internal/content/mdx/` directory, protocol seam shells, codegen dead
  re-exports and the JSR machinery are deleted (#694/#697/#741/#746);
  zero-consumer exports dropped across app/element/ui (#740/#743/#747);
  www guide pages share one shell and dead islands/icons/blog content are
  removed (#749/#748); audit reports archive under `docs/audit/` with the
  citation guard rescanning them (#751).
- Breaking (unfrozen alpha surface, per PACKAGE_SURFACE.md): `@openelement/app`
  drops `i18nStaticPaths`/`switchLocale`/`AppIslandOptions` and the
  `OpenElementRouteNode` re-export from `./model` (#743);
  `@openelement/ui/open-props-tokens` no longer exports `OPEN_PROPS_TOKEN_CSS`
  (#747); the generated ui manifest corrects open-tabs slots to
  `['tab','panel']` (#744). `@openelement/element` gains `@experimental`
  exports: ISR cache types (#729) and the third-party client runtime
  `hydrateOpenElement`/`disposeOpenElement` (#740).
- Docs truth: the npm registry line and the source line are now stated as two
  lines everywhere (README/ROADMAP/WORKFLOW/www), and the version-anchor and
  www-truth gates enforce the dual-line form (#730); `docs/integrations/` is
  covered by a package-surface truth gate (#737); the Fresh guide is rewritten
  against the real example (#728); the ISR KV adapter contract samples compile
  (#729).

## 0.42.0-alpha.9

- Cleanup train (TP-5.7, milestone #16): 13 findings from the 2026-07-30 team
  cross-review (issues #632–#644) landed as a quality/hygiene drop. No new
  product surface; ADR-0119 freeze surface and 0.42 Application Loop scope
  (ADR-0120) are untouched.
- Correctness: `<open-button>` now binds `_handleClick` as an arrow-field so the
  framework's raw `addEventListener` wires `this` to the component instance —
  shadow-DOM submit events now reach the outer form (#637). Request-scoped
  context is passed explicitly through render/hydrate entry points (#632/#644);
  logger `_warned` moved to render scope (#643); `app` reuses
  `@openelement/element`'s `createLogger` (#636).
- Hygiene: removed the redundant `app` re-export layer (#634); dropped a dead
  router data-context module; trimmed unused exports across `packages/*`
  (#633/#635/#642/#643/#644).
- Release evidence: closure recorded at the tagged merge commit; all five packages
  (`@openelement/element`, `app`, `adapter-vite`, `ui`, `create`) are published to npm
  with `dist-tag alpha=0.42.0-alpha.9`.

## 0.42.0-alpha.8

- **Incomplete release (npm-unpublished).** `v0.42.0-alpha.8` was cut as a
  mechanical version bump with a git tag and GitHub release, but the npm publish
  step failed and the packages were never published. It is a **version hole**:
  `git tag v0.42.0-alpha.8` and the GitHub release exist, but
  `@openelement/*@0.42.0-alpha.8` is absent from the registry and no AutoFlow3
  closure was written.
- Immediately superseded by `0.42.0-alpha.9`, the first fully npm-published
  `0.42.0` prerelease. Retained as-is per `docs/release/v0.42.0-alpha.8.md`
  (no closure by design). See that note for the post-mortem.

## 0.42.0-alpha.7

- Patch release (publish-existing): `0.42.0-alpha.6` → `0.42.0-alpha.7`,
  status `completed`. All five packages published to npm with `dist-tag alpha`;
  a full AutoFlow3 evidence chain was recorded (verify source version → main CI
  → artifact gate → publish npm → verify npm versions/dist-tags → consumer
  smoke → third-party Web Component smoke → stage/commit evidence → tag → push
  → GitHub release).
- Tag commit `e0e46281`; publish run `30431305870`. `/@fs/` Windows verification
  status tracked in `docs/current/HYDRATION_CONTRACT.md` (Known limitations).

## 0.42.0-alpha.6

- Audit round 2 remediation (TP-5.6): the second, independent review of
  the application loop
  (`docs/audit/2026-07-28-alpha5-round2-review.md` (historical; see git history),
  issues #576–#593) is closed — five high-severity defects in the morph
  client plus the protocol and evidence tail.
- Morph client correctness: an explicit `<form action>` now wins over
  the page URL on enhanced submits (#576); the popstate guard survives
  reloads and bfcache restores (#578); morphed-in islands show the
  server render (manual DSD instantiation before insertion, #579);
  morph matching is an ordered walk with exact deletion and relocation —
  reordered id-keyed lists keep order AND island state (#580); nested
  DSD compares normalized on both sides (#582); forms inside
  late-hydrating islands get the enhancement listener (#584); a
  cancelable `open:action-error` hook precedes the network-failure
  reload (#585); morph fallbacks log a reason in dev (#589).
- Detection: `hasEnhancedForms` follows relative imports, so an enhanced
  form inside a shared component no longer loses the enhancement layer
  silently (#577).
- Protocol tail: malformed form bodies answer 400 on both channels
  (#581); the redirect duck type honors the 3xx whitelist (#583);
  405 responses carry no-store/Vary (#586).
- Evidence: parity contract extended to JSON 404 / contract-violation
  500 / malformed-body 400 / 405 / the 303→GET chain (#587); local
  playwright retries are zero (#590); the alpha.2 note gets the
  enhancement-inert erratum (#591).

## 0.42.0-alpha.5

- Audit round 1 remediation (TP-5.5, ADR-0121): the first implementation
  audit of the 0.42 line (#539–#573) is closed — protocol hardening, a
  morph client rewrite, security hygiene and an evidence-honesty sweep.
- Headline root cause: the alpha.3 morph enhancement never fired — the
  `submit` event is not composed and page content lives inside
  page-element DSD shadow roots, so the document-level listener never saw
  enhanced forms. The client is rewritten around shadow-root submit
  interception and shadow-content morphing; the island-survival claims
  are now mechanically true (errata appended to the alpha.3/alpha.4
  notes).
- Protocol (ADR-0121): the prerender hard rule covers named `actions`;
  named-action dispatch is own-key gated; one `x-openelement-action`
  header (`true` = ActionResult JSON, `enhance` = HTML morph) with
  `Vary`; an action returning a `Response` is a contract violation; the
  default PRG strips the `?/name` marker; every 3xx coerces to 303 on
  POST and `redirect()` validates its status; fetch callers always
  receive ActionResult JSON (404/500 included, production-scrubbed);
  request-time responses carry `Cache-Control: no-store`; POST takes the
  same error boundary as GET; action POSTs get a 10 MB body limit;
  non-GET/POST methods answer 405.
- Morph continuity: form-scoped `data-open-region` targeting with
  navigation fallback, id-keyed + lookahead identity matching, popstate
  reload, `open:action-failure` restored (cancelable), submitter
  name/value preserved in the enhanced body, 500/cross-origin responses
  navigate instead of morphing, double-submit guard, fragment
  preservation, `<details>`/media state protection. The full survival
  matrix is documented in `docs/current/MORPH_CONTRACT.md`.
- Evidence: the request-time fixture suite (42 tests) runs on Chromium,
  Firefox and WebKit in the ci and release gate tiers; a static-output
  determinism gate ships (`check:static-output-freeze`); a dev(hono) vs
  build(Nitro) parity contract test boots both real servers; the perf
  baseline records its environment
  (`docs/release/v0.42.0-alpha.5-performance.json`).
- Also fixed along the way: dev SSR crashed on every route (missing
  `customElements` polyfill — now shipped to the dev entry);
  `[...path]` request-time routes; zero-island apps with enhanced forms
  (the enhancement layer is emitted only when enhanced forms exist, so
  island-only sites keep their lean bundle); the starter's `/contact`
  route (it was never shipped in `TEMPLATE_FILES`) now builds and is
  POST-smoked in consumer CI; SPA vs request-time loader/action types
  and docs are honest; a CSRF threat-model page ships in the guide.

## 0.42.0-alpha.4

- Hardening and recipes (TP-5, ADR-0120): the 0.42 line closes with
  integration proof instead of new semantics.
- Validation recipes verified in CI: zod (`/register`) and valibot
  (`/subscribe`) run inside fixture actions with 422/303 asserted in three
  engines — `docs/integrations/validation.md`. better-auth and Drizzle
  recipes are published as doc-level (honestly marked unverified):
  `docs/integrations/better-auth.md`, `docs/integrations/drizzle.md`.
- The `create` starter gains a request-time `/contact` route exercising
  the full loop (`rendering: 'dynamic'` + action + `data-open-enhance`),
  so starter consumers get the loop out of the box.
- `PACKAGE_SURFACE.md` records the 0.42 line additions as unfrozen with
  their freeze target.
- Performance baseline for 0.44: request-time render on the fixture is
  cold 28.6ms, warm p50 1.58ms / p95 2.97ms
  (`docs/release/v0.42.0-alpha.4-performance.json`).
- Fix (from alpha.3): the morph could replace an island whose light DOM
  carried whitespace-only text around the DSD template, resetting its
  state; the comparison now ignores whitespace-only text nodes, covered
  by the survival matrix in three engines (42/42).

## 0.42.0-alpha.3

- Revalidation continuity (ADR-0120): enhanced forms (`data-open-enhance`)
  now morph the returned document into place instead of reloading —
  submission returns the same HTML the no-JS path renders (303/422), the
  client morphs it, and `history.pushState` follows the PRG target.
- Island survival: a hydrated island whose light-DOM surface is unchanged
  in the incoming document keeps its shadow state (the DSD template child
  is excluded from the comparison). Islands whose surface changed are
  replaced; `data-open-preserve` exempts any subtree; the island client
  script is never re-executed by a morph.
- Named regions: a `data-open-region` container limits the morph to the
  matching region when present.
- The ActionResult JSON path remains for custom clients; the built-in
  enhancement uses HTML morphing for continuity.
- Fixture proof: counter island at 3 survives a 422 morph and a PRG
  morph; static/request-time mixed navigation — Chromium, Firefox and
  WebKit, 36/36.

## 0.42.0-alpha.2

- The form/action loop (ADR-0120): plain HTML forms work without
  JavaScript on `rendering: 'dynamic'` routes.
- Protocol: actions run before loaders (revalidation invariant);
  `fail(4xx, data)` returns take the 422 re-render channel with the echo;
  successful mutations answer 303 (PRG) — never a 200 render; redirects
  thrown from actions coerce to 303; POST without an action is a defined
  404.
- Named actions dispatch via `formaction='?/name'`
  (`export const actions = { name(ctx) {...} }`); unknown names are a
  defined 404.
- Fetch callers (`x-openelement-action` header) receive the `ActionResult`
  discriminated union (`failure`/`redirect`/`error`); the island client
  entry enhances `data-open-enhance` forms with the same protocol and no
  DOM surgery — unhydrated islands are untouched, failure falls back to
  the native 422 render unless the page handles `open:action-failure`.
- Contract: an action must be safe to re-run after a failed validation
  (validate first, mutate after).
- e2e: the full loop passes with `javaScriptEnabled: false` and on the JS
  enhancement path — Chromium, Firefox and WebKit, 33/33.

## 0.42.0-alpha.1

- First alpha of the 0.42 line (ADR-0120): request-time rendering gains
  semantics — `renderIntent.mode` was inert metadata before this release.
- `rendering: 'dynamic'` routes skip prerendering, dynamic expansion and
  i18n locale prerendering; they are served per request by the generated
  `dist/server/index.js` (nitro-mount over the same SSR bundle), with
  `dist/server/server-manifest.json` recording the partition.
- Hard rule (ADR-0120): pages with actions cannot be prerendered — a route
  module exporting an action without `mode: 'dynamic'` fails the build.
- BuildPlan evidence records `requestTimeRoutes`; pure-static projects emit
  no new artifacts (byte-identical public output proven against the 0.41.2
  build: zero HTML/JS/CSS differences).
- Request-time e2e fixture under
  `packages/adapter-vite/__fixtures__/request-time/` proves loader data
  varies per request and islands hydrate identically to static pages
  (Chromium, Firefox and WebKit, 12/12).
- Request-time HTML now receives the island client entry automatically —
  the generated server entry injects the same script the static pipeline
  injects post-build (found by the fixture; without it, islands on
  request-time pages never hydrated). A latent `__headExtras is not
  defined` codegen bug for projects without head extras is fixed too.
- Loader/action contract types (`Loader`/`LoaderContext`/`Action`/
  `ActionContext`) are unchanged — they already shipped; this alpha wires
  the rendering-mode semantics around them.

## 0.41.2

- Patch release: release-tooling self-repair (TP-0 of the 0.42.0 plan) — no
  public API, topology or runtime-default changes.
- A resumed patch release no longer skips a version: the target is
  re-derived from recorded evidence when a previous attempt already bumped
  the package line (the 0.41.1 → 0.41.2 incident, reverted in `10038c4d`).
- New release line-prose gate: the version-anchor bump records the www
  roadmap current-line entry's superseded theme in
  `tools/project-constants.ts`, and the www truth gate fails a release
  until the new release theme is written (the 0.41.1 bump had shipped
  alpha.19's theme under the `v0.41.1` timeline entry).

## 0.41.1

- Patch release: tooling hardening and hygiene from the third-party audit's
  fixable set — no public API, topology or runtime-default changes.
- adapter-vite `dist`/`.openElement` magic strings converge on shared
  `internal/paths.ts` constants; `tools/lib/fs.ts` gains shared
  `readText`/`readJson` used across ten tooling files.
- The repo-hygiene gate now scans credential files and credential-shaped
  content and rejects tracked binaries over 1 MiB outside intentional
  design/e2e/fixture locations.
- vite 8.0.10 → 8.0.16 across root, examples and adapter-vite (the latter's
  pin was the hidden cause of a tsc crash on dual-config typechecks).
- Version guards learn the stable line: www-truth retires the same-base
  alpha line instead of disabling itself on stable versions, publish dry-run
  skips already-published versions, and stale-claim fixtures no longer
  assume an alpha current line.
- `CONTRIBUTING.md` records the `no-sloppy-imports` rationale; stale merged
  branches were pruned.

## 0.41.0

- Stable five-package release (ADR-0119): the interface freeze covers
  `defineElement`, `definePage`, `buildApp`, the package graph, the supported
  subpaths and the static/SPA semantics of `defineApp`; request-time data,
  forms, sessions and cache stay explicitly unfrozen until 0.42/0.44.
- Adapter-vite internal subpaths pruned at the freeze (`app-vite`,
  `build-context`, `head-injection`, `i18n-plugin`, `plugin`,
  `generated-data-resolver`, `plugin-mdx`, `route-manifest`,
  `cli/build-client`, `cli/build-ssg`) — use the root, `nitro-mount`,
  `cli/build` and `sitemap` instead (breaking; see the migration guide).
- The #390 external adopter pilot is retired by maintainer decision after
  zero recruitment (recorded exception, not replaced with internal evidence);
  the seven-day P0 watch on the 0.41.x patch line starts at this release.
- Aggregate migration guide from 0.40.x and every alpha line release:
  `docs/release/v0.41.0-migration.md` and the site's `/guide/migration` page.
- ui control geometry is squared (`--btn-radius`, `--badge-radius`,
  `--ui-control-radius`: `--radius-round` → `--radius-1`, 6px) — visual
  breaking change; update screenshots and custom control CSS.
- The release verifier now supports stable `x.y.z` versions
  (prerelease-only before), and the version guards stay honest on a stable
  current line.

## 0.41.0-alpha.19

- Third audit round cleanup sweep (ADR-0118, issues #481-#506); no new
  product surface.
- Fixes the reflect removal suppression (Boolean `default: true` desync),
  the popstate redirect-then-block URL fork, and For drift-token separator
  collisions; the reflect browser spec joins the Firefox/WebKit smoke gates.
- Closes the export-star seams: the element root switches to explicit type
  export lists, `SafeHtml`/`UnsafeHtml`/`StyleSheetRule` leave the root for
  real, and the internal `open-element-render`/`open-element-hydration`
  subpaths are pruned from element exports (breaking type-surface changes;
  see the GitHub prerelease notes for migration).
- Single-sources `HYDRATION_STRATEGIES` and the routeInfo contract, sinks
  the release executor into `release.ts` with orchestration tests, and
  preserves curated release-note sections so migration records stay in the
  durable record.
- Mechanizes the audit's edge findings: www truth catches bare version
  mentions, anchor gates catch body drift, the assertion-style gate covers
  every package test, graph direction rules are explicit, and the deno-api
  check catches `globalThis.Deno`/destructuring/`npm:` patterns.
- Deletes the third-round dead-code inventory (renderDsdStream,
  bindHydrateEvents, generateHonoEntryCode, tools/test-fixtures, orphan
  tasks, dead config entries) and rewrites the always-true test assertions.

## 0.41.0-alpha.18

- Fixes the `reflect: true` static-prop write loop and SSR attribute
  overwrite; resolves the root-level `<Show>`/`<For>` CSR edge; unifies
  prop attribute casing; makes `For` branch tokens content-sensitive;
  fixes client-runtime double hydration; runs router guards on history
  traversal; honors `prefers-color-scheme` in theme-init.
- Shares one CEM admission plan across dev/SSR/SSG; dynamic-route render
  failures now fail the build (opt-out `'warn'`); failed pages never ship
  nor enter the ISR manifest; static non-200 outcomes are summarized.
- Local releases land evidence and closure on main; anchor gates reject
  stale version claims; the bump maintains every currency line; the
  release executor resumes from failures.
- Adds WebKit smoke to CI, gates examples checks, single-sources the
  guide with real Chinese rendering, and covers the SPA action chain in a
  real browser.
- Removes dead exports, fields and scripts (breaking; see the GitHub
  prerelease notes for migration), removes `renderIntent.streaming`,
  converges fmt/lint exclusions, and retires stale files and config entries.

## 0.41.0-alpha.17

- Covers hydration and binding behavior in a real browser: signal text
  patching, event hydration, SSR/hydration mismatch fallback and form
  submission through shadow boundaries.
- Wires SSR error collection: a failing route render produces a defined 500
  result with `RenderError` diagnostics; the unread `hydrationHints`
  contract is removed.
- Converges island declaration construction, single-instantiates the entry
  descriptor, deduplicates the SPA/SSG phase-2 blocks and shares route
  rendering helpers; deletes the unwired external-resolver, the
  `clientOnlyTags` chain and dead build-context fields.
- Counts every source file in the coverage denominator and re-baselines
  thresholds on measured values; the critical-path gate runs its e2e suites
  for real and can no longer skip them on failure output.
- Adds a Firefox smoke project to CI for the core DSD/hydration/theme
  specs.
- Adds a mechanical version-anchor gate across governance documents, and
  the release bump now maintains `ACTIVE_EXECUTION_VERSION`.
- Fixes `publish-existing` evidence: records the true previous package
  line, rewrites GitHub release notes from completed evidence, and
  generates the release closure record automatically.
- Moves adapter build-time utilities from the `@openelement/element` root
  to `@openelement/element/build-utils`, stops exporting internal router
  types from the `@openelement/app` root, and aligns `PACKAGE_SURFACE.md`
  with a machine-checked exports inventory. Breaking surface removals:
  element root build utilities (migrate to `./build-utils`), app root
  `RouteConfig`/`RouterInstance`/`RouterMode` types, adapter-vite
  `ExternalManifest` type and `SsgPageOutput.hydrationHints`.
- Publishes the #390 external adopter pilot kit and launches recruitment.

## 0.41.0-alpha.16

- Fixes unknown dynamic-route params serving 200: a `notFound()` thrown from
  a page element's render now propagates through the DSD render chain as
  protocol control flow (duck-typed alongside redirect) so the request-time
  server entry answers 404 (#922). The starter blog route now signals
  not-found this way instead of rendering a 200 "Post not found" page.
- Aligns SSR and hydration event markers for custom-element hosts and
  `Show`/`For` branches; hydration validates marker counts and branch tokens
  and falls back to client re-render on mismatch.
- Merges static-props `observedAttributes` at class-definition time so
  attribute-to-signal synchronization works in real browsers.
- Matches island chunks via the client build manifest, fixes base64url hash
  handling, names `.tsx`/`.jsx` island chunks, and normalizes Windows
  drive-letter island paths (#460).
- Enforces the npm `latest` dist-tag invariant for prereleases in the publish
  tooling and release verifier.
- Clears current-truth drift across governance documents and removes dead
  gate triggers (ADR-0116 packages A and E).

## 0.41.0-alpha.15

- Modernizes the CI runtime (GitHub Actions Node 24 with reviewed immutable
  SHAs) and makes external review advisory.
- Enforces current-truth wording mechanically across governance documents and
  the website.
- Ships the #390 external-adopter pilot kit, cross-platform published-consumer
  runs and a five-package public-interface snapshot for the freeze rehearsal.
- Records the stable-readiness dossier; #390 and #37 remain open by design.

## 0.41.0-alpha.14

- Recovers the release line with an exact-version starter, verified published
  consumers and honest two-stage release evidence.
- Publishes all five packages under the `alpha` dist-tag with post-publish
  Deno, Node ESM, Nitro and third-party Web Component smoke evidence.

## 0.41.0-alpha.13 (publication failed; changes shipped in alpha.14)

- Removes the alpha-only `defineLayout` alias; use `defineElement` with the same
  arguments for layout elements.
- Restores declared static-prop defaults when reflected attributes are removed.
- Hardens SSR prop injection, custom-element hydration, params parsing, nested
  SSR depth, and adopted stylesheet composition.
- Stabilizes SPA action errors, caches same-route GET requests, bounds render
  data contexts, and compiles client routes into a declaration-ordered trie.
- Removes Preact bridge top-level await and public data-context mutation hooks.
- Hardens Adapter Vite i18n, head sanitization, sitemap, island manifests,
  npm-specifier rewriting, asynchronous manifest reads, CORS defaults, and
  AST-based route metadata extraction.
- Moves UI tokens to a CSS source of truth with generated-output drift checks,
  and makes Create template generation asynchronous, deterministic, and bound
  to the five-package same-version release invariant.

## 0.41.0-alpha.12

Audit-remediation foundation release: closes the 13 high-severity findings
from the `0.41.0-alpha12` full code audit (issues #424–#428). No in-repo
release note was written at release time; the retrospective gap note is
`docs/release/v0.41.0-alpha.12.md`.

- Fixes core runtime issues, including the `signal-context` infinite loop
  and `ErrorBoundary` retry.
- Hardens SSG/build: command-injection closure, dynamic-route encoding, and
  pure-Node `process.cwd()` compatibility.
- Repairs contract-checker correctness and backfills release-tooling tests.

## 0.41.0-alpha.11

- Restores frozen-install and changed-path/release workflow truth.
- Fixes query decoding, SPA page-host data, dialog inert restoration, and
  theme propagation.
- Consolidates the Element/Adapter protocol seam and removes verified dead
  DSD, CEM, route-scanner, and UI escape code.
- Repairs clean Nitro Workers builds, semantic visual smoke, and package
  artifact allowlists.
- Enforces publishable runtime coverage at 69% lines, 81% branches, and 72%
  functions; published with tag, GitHub prerelease and post-publish consumer
  evidence (see `docs/release/v0.41.0-alpha.11.md`).
