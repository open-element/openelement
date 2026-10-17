# ADR-0164: Island style asset protocol — extracted sheets, dual adapters, three-owner seam split

- Status: ACCEPTED (implemented in production: extracted sheets flow through
  the style-asset pipeline, e.g. `packages/router/src/vite/internal/style-assets.ts`)
- Decided: 2026-10-07 (owner design session; implementation contract recorded
  in the #1553 comments of 2026-10-06)
- Origin: issue #1553, riding the #1543 island-CSS seam

## Context

Island chunks inline their component stylesheets as JS template literals.
`www/site-budget.ts` names the consequence in its own comment: the largest
`island-*` chunk is open-layout at ~96.5 KiB, dominated by the compiled shell
plus inlined critical CSS, and `islandKB` was raised 100 → 102 to absorb it.
The bytes are JS for delivery purposes, so the CSS hash is welded to the JS
hash (any sheet edit re-invalidates the whole chunk), and the oxc minifier
never touches template-literal content — which is why #1543 shipped a
special-purpose CSS minifier that runs over island chunk source.

The owner ruling on #1553: **island chunks stop carrying inlined stylesheet
content**. Framework-level CSS extraction in the client island build — island
stylesheets emit as real CSS resources instead of template-literal bytes
inside JS chunks, with DSD/claim behavior and the deterministic build
contracts preserved.

The naive reading of the target was native CSS Module Scripts
(`import sheet from './x.css' with { type: 'css' }`). The implementation
contract's external verification + main-agent reproduction corrected that:
the native import-attribute form **hard-fails on the current toolchain**.
The corrected shape is an OpenElement-controlled style asset protocol. This
ADR records that shape, the ownership rulings behind it, and the four
capability-spike verifications that ground it.

### Current state, verified in tree

- The compiler copies the `static styles` initializer verbatim into the
  part-program module
  (`packages/element/src/internal/compiler/semantic-core/emit-module.ts:387-396`);
  the sheet text therefore ships as template-literal bytes inside island
  chunks — the #1543 admission channel
  (`packages/router/src/vite/internal/island-css.ts:239-249`).
- The server serializer emits styled components' CSS as one marked
  `<style data-oe-static-styles>` element, the first template child
  (`packages/element/src/internal/compiled/server/index.ts:440`).
- Claim skips exactly that node (`cursorStart = hasStaticStyle ? 1 : 0`,
  `packages/element/src/internal/compiled/runtime/claim.ts:658-663`) but
  never removes it, while the kernel simultaneously applies the same styles
  through `adoptedStyleSheets` (`CompiledStyleScope.connect`,
  `packages/element/src/open-element-styles.ts:64-73`; kernel sets
  `expectStaticStyle: styleCount > 0` at
  `packages/element/src/internal/compiled/runtime/kernel.ts:313`). The rules
  are double-applied today.
- The client asset manifest carries `entry` / `islands` / `shared` only
  (`packages/router/src/vite/internal/protocol/client-assets.ts:36-43`);
  there is no styles field.

## Decision

### 1. Three-owner seam split (the P8 answer)

One boundary, three systems, one named owner each:

| Owner | Owns | Never does |
| --- | --- | --- |
| Element compiler | Static-style **admission** (which initializers qualify) and style **descriptor generation** (the OE-controlled style-resource request per admitted sheet) | Write files. The compiler never emits bytes to disk. |
| Router client build | The emitted **`.css` artifact**: `emitFile`, content hash, filename, manifest mapping, and the import **adapter** handed back to the module graph | Re-parse runtime style semantics. |
| Element runtime | Sheet **adoption** (`adoptedStyleSheets`) and post-claim **DSD cleanup** (removing the marked style node) | Guess filenames. |

The crossing artifacts are derived, not copied: the runtime's sheet URL comes
from the client asset manifest's styles field; the server's DSD CSS text is
read from the same emitted asset (hash-checked against the client sheet), so
DSD output and adopted sheet cannot drift.

### 2. Protocol shape

The compiler stops embedding stylesheet strings in island modules and emits
an OE-controlled style-resource request instead — a sibling module id with a
reserved suffix (contract shape: `./component.oe-style.css`). The OE vite
plugin (router build, `enforce: 'pre'`) intercepts that request **before
vite's CSS plugin**, emits the real `.css` asset via the router build, and
hands back a **sheet adapter** module: a plain JS module whose default export
is the `CSSStyleSheet` for that sheet.

By construction this gives:

- **Cache decoupling** — the CSS hash is separate from the JS hash.
- **O(1) adoption** — every instance adopts the same pre-parsed sheet
  (pointer assignment, not string parsing).
- **No FOUC race** — module evaluation cannot complete before the sheet is
  ready (the fallback adapter guarantees this with top-level await; see
  Appendix D).
- **Preserved self-containment** — the import edge travels with the package;
  the client asset manifest gains a `styles` field naming the preloadable
  resource URLs (shadow-component CSS can never be applied as a
  document-level `<link>` — it cannot reach shadow trees — so preload is its
  only document-channel role).

### 3. Dual adapters, one asset

The adapter handed back by the intercepting plugin takes one of two forms,
selected by capability; both consume the same emitted `.css` asset:

1. **Native CSS-module-script adapter** — where the runtime capability-probes
   support, the module imports the sheet natively
   (`import sheet from './x.css' with { type: 'css' }`) and the browser's own
   CSS module machinery provides the `CSSStyleSheet`. Zero framework code.
2. **Fetch adapter** — otherwise a URL + `fetch()` +
   `CSSStyleSheet.replace()` adapter, TLA-guarded so the sheet is ready
   before module evaluation completes.

Never document-head injection, on either adapter. The fetch adapter puts one
small cached fetch on the critical path for client-created islands (first
paint is unaffected — DSD covers it); the manifest-driven `styles` preload
mitigation is part of the protocol, not an optimization afterthought.

The TLA in the fallback adapter propagates async-module semantics through
consumer bundles. That is acceptable in 2026, but it is a real contract
surface for the bundler matrix (Appendix D).

### 4. Static admission v1 — fail-closed for islands

Island admission accepts only statically provable sheets:

- template literals without interpolation;
- `compiledStyle()`-marked calls;
- static arrays of the above;
- same-module constants.

Dynamic composition (the www `page-blog-post-styles.ts` /
`open-article-view-styles.ts` patterns) is a **build-time error with a
migration hint**. A silent fallback to inline strings would void this
issue's acceptance: the guarantee is zero inlined stylesheets in island
chunks, and a quiet inline path is a second, unowned write on the same seam.

Non-island / server-only components may keep the legacy path, explicitly out
of the zero-inline guarantee.

**Production lane note (#1553 compiler lane, 2026-10-06) — the guarantee's
scope and its activation.** The compiler ships the admission and the request
generation behind an explicit host activation (`styleAssetProtocol` on the
semantic core / `compiledElementPlugin` options). Inside an activated build
the four v1 shapes are admitted, one reserved-suffix sibling request
(`./<tag>.oe-style.css`) is generated per component (the admitted sheets
joined in authored order), same-module `const` style declarations are admitted
and erased from the generated module, and everything else fails closed with
OEC9028. Non-island modules take the legacy verbatim path in every build.
Until a host activates the protocol, its islands ride the legacy path too —
outside the guarantee. That is a transition, not a shim (P5): the activation
default flips on and the option retires once the router build — the only host
that can produce island modules, since `defineIslandConfig` admission rides
its injected sidecar descriptor — always activates. The request's CSS payload
reaches the intercepting build through an in-process registry
(`element/src/internal/compiler/style-requests.ts`): the compiled-element
transform is its one writer, the style-asset plugin its one reader, keyed by
the module id the bundler's resolver lands on for the emitted import; a
second writer there is a defect under P8.

### 5. Claim-then-delete timing

Target lifecycle of the static-style channels:

1. **First paint**: the DSD `<style data-oe-static-styles>` node inside the
   shadow root serves the styles — no JS on the path.
2. **Claim** (scan phase): the marked style node is skipped as today
   (`cursorStart`/`rootOffset = 1`). Removal must not precede claim: Part
   paths assume the node exists.
3. **After successful claim, after part binding**: the runtime removes the
   DSD style node and keeps the shared adopted sheet. This retires today's
   double application (marked node + adopted sheet).
4. **Claim failure**: the DSD style node stays until recovery completes —
   the never-upgrade and recovery paths keep first-paint styling by
   construction.

| Scenario | DSD style node | Adopted sheet |
| --- | --- | --- |
| Pre-upgrade (no runtime loaded) | present (first paint) | none |
| Never upgrades (no-JS or entry failure) | present — correct and sufficient | none |
| Claim in progress (scan phase) | present — Part paths assume it | kernel applies shared sheet |
| Claim succeeded (after part binding) | **removed** | shared sheet only |
| Claim failed, recovery pending | **kept** | recovery owns the rebuild |
| Recovery completed | removed (with the rebuilt root's own lifecycle) | shared sheet only |

### 6. Division of labor with #1548

#1553 is **the pipe**: extraction, the asset protocol, the adapters, the
claim-then-delete handoff. Dead-CSS elimination is not this issue — pruning
is the compiler's job and #1548 rides on top of this pipe. Pruning
granularity vs cache reuse (one sheet per component vs per family) is a
product decision for #1548, not for the protocol. The #1543 island-CSS
minification transform likely retires or shrinks once extraction lands:
there is no JS-embedded CSS left to collapse, and the asset emit point is a
plain CSS pipeline (the contract in
`packages/router/src/vite/internal/island-css.ts` documents the admission it
would no longer see).

### 7. Consequences and retirement conditions (P5)

- **Adopted on the platform, deleting framework code**: constructable
  stylesheets + `adoptedStyleSheets` are already universal (Appendix C) —
  the platform tax this protocol pays is the irreducible single
  `adoptedStyleSheets` assignment per shadow root, nothing more.
- **The fetch adapter is a shim with a written retirement condition**: when
  the native CSS-module-script channel is usable on the toolchain *and* the
  browser support matrix covers the delivered fleet (Appendix C shows
  Safari is the gap today), the fetch adapter form is deleted and the
  compiler's request mapping emits the native import. The adapter form is a
  capability probe, not a permanent architecture.
- **The `.oe-style.css` suffix is a seam**: it is the compiler's request
  channel into the router build; a second writer that interprets it (or a
  bundler that consumes it directly) is a defect under P8.
- **Site-budget caps** are re-derived from the new shape (`islandKB` likely
  drops sharply — styles leave JS entirely); doc-figures re-baseline is the
  final-calibration lane's job.

## Appendix A — Spike a: vite interception point (reproduced)

Toolchain: repo `vite 8.0.16` (rolldown `1.0.3`), programmatic `build()` in a
`/tmp` sandbox, `format: 'esm'` (the client build's format,
`packages/router/src/cli/build-client.ts:496,556`).

- **Native form fails (reproduces the contract's empirical finding).**
  `import sheet from './x.css' with { type: 'css' }` →
  `[MISSING_EXPORT] "default" is not exported by "x.css"`. The bundler
  resolves the CSS file as an ES module with no default export; vite's CSS
  transform never turns it into a CSS module script.
- **`enforce: 'pre'` + `resolveId` + `load` is the interception point.** With
  the plugin at `enforce: 'pre'`, returning a resolved id for
  `comp.oe-style.css` and a load result: build OK; the load hook's returned
  adapter JS became the module content (a post-phase transform probe saw the
  adapter code, not CSS); the real `.css` asset was emitted from the load
  hook via `this.emitFile({ type: 'asset', fileName: 'assets/comp.css' })`
  and landed byte-identical in the output.
- **Normal phase does not intercept — it is not a preference but a hard
  ordering fact.** The same hooks without `enforce: 'pre'` reproduced
  MISSING_EXPORT: core CSS/rolldown handling runs before user normal-phase
  plugins, so `resolveId`/`load` never answered.
- **The vite build manifest does not record `emitFile` assets** (only entry
  chunks appear in `.vite/manifest.json`). The router build's asset-to-URL
  mapping must therefore come from the plugin's own `emitFile` bookkeeping —
  consistent with the router client build being the artifact's single owner.

## Appendix B — Spike b: webpack 5 consumer behavior (reproduced)

Toolchain: `webpack 5.111.1`, minimal consumer in a `/tmp` sandbox, three
scenarios against the protocol's shapes:

1. **Fetch adapter module (the protocol's fallback form): clean.** webpack
   consumed the TLA adapter module with its async-module machinery, and
   natively handled the `new URL('./comp.css', import.meta.url)` asset
   reference: it emitted `comp.css` as a real hashed asset
   (`42680d6884c5c3c1febd.css`) and handed the adapter the runtime URL. The
   fallback adapter's two needs — JS bundling of the module and a URL for
   the asset — are both met without any loader.
2. **Native import-attribute form: webpack downgrades it.** With a
   side-effectful consumer,
   `import sheet from './comp.css' with { type: 'css' }` compiled to
   `new CSSStyleSheet(); sheet.replaceSync(':host{color:#639}')` — the sheet
   semantics survive (a real constructable stylesheet, no document-head
   injection), but the CSS bytes are **inlined back into the JS chunk**,
   exactly the delivery shape #1553 exists to eliminate, with no `.css`
   asset emitted and no error. A consumer bundler silently voids the
   zero-inline guarantee if the native form leaks into consumer builds.
   (Earlier, with a tree-shakeable consumer, the same import compiled to an
   **empty chunk** — the shape can vanish without any diagnostic.)
3. **Conclusion (documentary per the contract):** the cross-bundler contract
   is the adapter module + asset URL, not the native import attribute. The
   bundler matrix records: rolldown 1.0.3 fails closed (MISSING_EXPORT);
   webpack 5.111+ silently inlines the native form; both consume the adapter
   form faithfully.

## Appendix C — Spike c: native CSS Module Script support matrix

caniuse-level facts (MDN browser-compat-data queried in-session from the
published `@mdn/browser-compat-data` package; esmodules.com matrix, current
as of late 2026):

- **Constructable stylesheets** (`CSSStyleSheet` constructor, `replace()`,
  `replaceSync()`, `adoptedStyleSheets` on `Document` and `ShadowRoot`) —
  Chrome/Edge 73+, Firefox 101+, Safari 16.4+. Universal in 2026. This is
  the platform basis of **both** adapters.
- **Import attributes, `with` syntax** — Chrome/Edge 123+, Firefox 138+,
  Safari 17.2+, Node 18.20/20.10+. Baseline 2025 (MDN: newly available since
  April 2025). The earlier `assert` syntax: Chrome 91+, never in Firefox or
  Safari.
- **CSS module scripts, `with { type: 'css' }`** — Chrome/Edge 123+,
  Firefox 147+, Deno 2.9, Bun; **Safari: not implemented** (through Safari
  27, released 2026-09). `assert { type: 'css' }`: Chrome/Edge 93+ only
  (web.dev).

Conclusion: the native adapter cannot be the only form — Safari, a
first-class delivery target, has no native channel today. The dual-adapter
ruling is not defensive engineering; it is the support matrix talking. The
fetch adapter's platform basis (constructable stylesheets) is itself
universal, so the fallback loses nothing the native form would gain beyond
the one fetch.

## Appendix D — Spike d: fetch + `CSSStyleSheet.replace()` fallback adapter, TLA behavior

- **Module-evaluation ordering (Node ESM, reproduced).** An adapter module
  with top-level `await fetch(...)` + `await sheet.replace(...)` exported
  the fully-populated sheet: the importing module's body ran strictly after
  the adapter's awaits resolved (`[adapter] sheet ready` before
  `[island] module evaluated`). This is spec behavior: a TLA dependency
  makes the module async, and importers cannot evaluate before it settles.
- **Failure mode is fail-closed (reproduced).** When the adapter's
  fetch/replace chain rejected, the importing module never evaluated — no
  island code runs against an empty sheet.
- **Bundler propagation (vite 8.0.16 / rolldown 1.0.3, reproduced).**
  `format: 'esm'` builds preserve the TLA verbatim at the chunk's top level
  (static-importer chunks become async modules; dynamic-importer chunks
  already await the `import()`), so the ordering guarantee survives
  bundling. `format: 'iife'` hard-fails at build time:
  `[UNSUPPORTED_FEATURE] Top-level await is currently not supported with the
  'iife' output format` — the async-module contract surfaces as a build
  error, never as silent reordering. The repo's client build is ESM
  (`packages/router/src/cli/build-client.ts:496,556`); any future consumer
  that must ship iife/umd over an island chunk carrying the adapter fails
  its build instead of shipping a broken ordering — the correct, fail-closed
  direction. webpack 5.111.1 handled the TLA module through its own
  async-module machinery (Appendix B).
- **`replace()` semantics** (MDN, platform fact): resolves to the sheet,
  rejects on `@import` (constructable sheets cannot load nested
  stylesheets) — the emitted asset must therefore be a flat sheet, which
  the v1 static admission already guarantees.

## Amendment (2026-10-07): styleAssetProtocol option retained pending #1558 — named deviation

The retirement condition recorded above is textually met by this change (the router build is
the sole host and hardcodes activation). The option is nevertheless retained through alpha.10
with this named explanation per P5 comply-or-explain: #1558 (file-based styles as the only
authoring form) deletes the entire admission machinery within weeks, and retiring the option
now would break the public compiler surface twice in two consecutive releases for zero user
benefit. The option retires with the admission machinery in #1558.

## Amendment (2026-10-07): #1558 retires the string admission machine and the styleAssetProtocol option

The protocol's request channel is kept, but its input changes shape: the one style
authoring form is now a real `.css` file imported into the compiled module and arrayed
in `static styles` (#1558, P5 — the `css` string-template machine deleted, no shim).
Consequences, each retiring machinery this ADR carried:

- **Admission is the import edge.** The v1 static-proof machine
  (`style-admission.ts`, the four admitted shapes, same-module style constants, the
  OEC9028 dynamic-composition diagnostic) is deleted. The compiler polices only the
  import/initializer shape (OEC9029: relative `.css` default imports arrayed in
  `static styles`); the sheet bytes live in exactly one place — the authored file —
  so the registry carries edge coordinates, never CSS text.
- **The reserved `.oe-style.css` suffix is retired with the string channel.** The
  request is the authored specifier itself; the intercept keys on the edge registry
  (importer + authored `.css` specifier), and a `.css` import from an untracked
  module rides vite's own CSS channel as a plain app stylesheet.
- **`styleAssetProtocol` is deleted** — the option's retirement condition (recorded
  in the previous amendment) is met: the router build registers edges unconditionally,
  island and non-island compiled modules alike; the legacy verbatim path no longer
  exists. There is no activation surface left to configure.
- **The #1543 island-CSS minifier retires with it** — with string sheets deleted
  from the language, no JS-embedded component CSS exists to minify.
- **The SSR half reads the authored file** — the client build's emitted asset is
  content-hashed from the same bytes, so the drift-reconciliation machinery
  (STYLE_ASSET_UNMAPPED / HASH_MISMATCH) retires: one fact, two consumers.
- **Fetch/native adapter verdict unchanged** (Appendix C stands): Safari still has
  no CSS module scripts, and rolldown still fails the native form; the fetch adapter
  keeps its written retirement condition.

## Amendment (2026-10-12): light-root components join the one asset protocol (S-C1.2)

A light root has no native style boundary: its DOM is the document's DOM. The
protocol therefore serves light-root sheets from the SAME emission — one asset
per authored edge, content-addressed, emitted by the client build — with the
component's scope written into the asset at build time, and the runtime only
ever installing the sheet object it was handed.

**The delivery, end to end.**

1. **Build-time scoping.** A light-root component's edge is emitted as
   `@scope (<component tag>) { … }` around the authored bytes
   (`router/vite/internal/light-css-scope.ts`), so the boundary exists in the
   file a browser parses. `:host`/`:host(<sel>)`/`::slotted(<sel>)` project onto
   `:scope`/`:scope:is(<sel>)`/`slot > :is(<sel>)` — byte-for-byte the rewrite
   the runtime used to apply. Prologue at-rules (`@charset`, `@import`,
   `@namespace`) are hoisted above the wrapper: they are only valid before any
   other rule, and they stay unscoped — the honest boundary, since the protocol
   scopes the sheet it owns.
2. **Scope identity rides the edge key.** The component tag is part of the
   registry key (`file` + `\0` + tag), because two components sharing one sheet
   file are two resources with two scopes. The compiler's transform registers
   the key explicitly (`styleRequestModuleId(importer, specifier, scopeTag)`)
   and the intercept resolves the same key from the importer index — a
   disagreement fails closed at the intercept instead of emitting an unscoped
   asset.
3. **SSR: the document declares the resource.** A light-root component reports
   its external sheet URLs into the render's `DocumentStyleResources`, and
   `wrapInDocument` serializes them as marked `<link rel="stylesheet">` nodes in
   the original document head, after `headExtras` (the site's document
   stylesheet). The component's subtree carries neither link nor text.
4. **CSR: the document adopts the sheet.** `CompiledStyleScope` installs the
   sheet object on the document that holds the component's DOM
   (`adoptedStyleSheets`), the same way it installs shadow sheets on a shadow
   root. The document is shared state, so a light scope never removes: the sheet
   is a per-component-type singleton whose rules are `@scope`-bounded, other
   live instances still need it, and `document.adoptedStyleSheets` is itself the
   record.
5. **One delivery per resource, still.** A marked document link IS a delivery:
   `sheetDeliveredByLink` now compares a link's href against the sheet's
   expected URL through the S-C1.1 canonical identity
   (`origin + pathname + search` against the document base) and skips adoption —
   so an SSR page does not parse and apply the same rules twice, and a CSR-only
   page adopts exactly once.

**Retired machinery (verified deletion).** The light-DOM style sink is gone:
`CompiledStyleScope.#lightStyle`, the runtime `document.createElement('style')`
+ `document.head.appendChild`, the `cssRules` text snapshot (`styleText`), the
readiness-triggered re-write, `document.head` node removal on disconnect, the
runtime scoping module (`element/internal/compiled/style.ts`) and its
`OE_STYLES_LIGHT_SINK_WITHOUT_DOCUMENT` code, and the `mode === 'light'`
cutoffs in `declaredStyleLinks`/`renderToString`. `cssRules` is not read at all
any longer, which also retires the cross-engine filling-sheet race (KR-2/Q1-B)
by construction.

**Boundary, stated rather than hidden.** The asset protocol's owner is the
client build, so a compiled component the client graph never contains (a page
component that is not an island, or an island-free build) has no emitted
resource and therefore no document link. Those sheets keep the pre-existing
marked inline `<style data-oe-static-styles>` node inside the host — now
carrying the build-time-scoped bytes the SSR half emits, with no runtime
scoping and no client JavaScript required. Emitting that class of asset would
mean a second emission owner and a second asset manifest, which this lane
rejects; the boundary is recorded here instead.

**Scan boundary and its retirement condition.** The scoping transform is a
string-, comment- and escape-aware scan, not a regex pass over CSS text, because
this toolchain ships no CSS parser the router may resolve (postcss,
lightningcss and css-tree are all unresolvable from `@openelement/router`; the
installed Tailwind toolchain exposes only its own compiler and minifier). When a
CSS AST becomes resolvable, `light-css-scope.ts` is the single seam to swap —
the asset contract above does not change.

## Amendment (2026-10-12): Dev serves authored CSS as a real resource (S-C1.3)

Development used to carry the authored sheet's TEXT inside the generated
adapter (`StyleSheet` + `replaceSync(<css>)`) and, because that sheet had no
URL, the dev SSR markup inlined the same text in a `<style>` node. Dev now
delivers the identical facts production delivers, from the dev server.

**The resource.** Every registered edge gets one endpoint,
`<base>.openElement/authored-css.<digest>.css`, served `text/css` with
`Cache-Control: no-store`. The digest is a hash of the registry key, so the
authored path and the component scope never appear in the URL and two edges
cannot collide. The bytes are Vite's OWN processing of the authored file —
`server.environments.client.transformRequest(file + '?inline')`, the documented
"import a CSS file as a string" form: the project's PostCSS chain runs,
`@import` dependencies resolve, and every relative `url()` is rewritten to a
base-absolute dev URL — followed by the same `@scope (<tag>)` projection the
build applies (`scopeEdgeCss`, one scope decision for every half). No second
CSS compiler, no second asset manifest, no disk staging: the endpoint reads the
same authored bytes the build reads.

**Why `?inline`, specifically.** A relative reference inside a stylesheet
resolves against the STYLESHEET's URL in a `<link>` delivery but against the
DOCUMENT's base in a constructed (`replace()`d) sheet — the one semantic
difference between the two deliveries this protocol uses. Rewriting the
reference to a base-absolute URL at serve time removes the difference: both
deliveries name the same resource, and a public asset referenced as
`url('/x.png')` is delivered unchanged in dev and after a build. The dev
endpoint fails closed on any module shape it cannot read (a 500 with the
reason), never falling back to unrelated text.

**The adapter.** The generated dev edge module carries the URL and nothing
else: `fetch()` into ONE realm-held, per-edge `CSSStyleSheet`
(`globalThis.__openElementDevStyleSheets`, keyed by the edge digest) with
`STYLE_SHEET_READY`/`STYLE_SHEET_URL` as before, plus a per-evaluation revision
so an older in-flight response can never overwrite a newer sheet. The server
half of the same edge is a URL-only shim, so the dev DSD template and the dev
document head declare `<link rel="stylesheet" data-oe-static-styles>` for the
authored edges — parser-visible, no JavaScript needed, no inline CSS — exactly
the shape production produces.

**Live sheets and HMR.** A dev sheet carries the new protocol key
`STYLE_SHEET_LIVE`: a root adopts it even when its markup declares the same
URL, because the adopted object is the copy an edit re-fills. That is the one
deliberate dev/production difference, and it is what makes a CSS-only edit
reach connected roots without a DOM write: the edit invalidates the edge module
in every environment, invalidates nothing else, and sends ONE `js-update` for
the module's browser-facing id — `<base>@id/__x00__<graph id minus NUL>`, the
form Vite's client matches (the graph entry carries the raw virtual id when it
was created from the id rather than from a request). No full reload, no
node, and `replace()` keeps the sheet identity every root already holds. The
dev resource's first-paint delivery stays the markup link, so a JavaScript-less
document is styled by the same links a built site uses.

**Retired machinery (verified deletion).** `inlineSheetAdapterModule` and its
`replaceSync(<css text>)` emission; the dev `?inline`-less byte path
(`readEdgeFile` in the dev half); the `full-reload` branch that a `.css` edit
of a tracked edge used to take (its replacement is the js-update above); and
the `style-assets.test.ts` assertions that pinned the inline adapter text
(rewritten to pin the resource-URL adapter and the URL-only shim).

**Boundary, stated rather than hidden.** An authored sheet's relative
references are resolved by Vite in DEV; the BUILD's emitted asset is still the
authored file's own bytes, so a relative `url()` inside a component sheet is
resolved against the emitted asset's URL there (`assets/<hash>.css` →
`assets/<name>`), not against the source tree. Public assets referenced with a
base-absolute URL are unaffected in both. Making the built asset carry
Vite-resolved URLs is the same seam (`readEdgeCss` → Vite's CSS pipeline) but a
separate change to the client build's emission; it is recorded as outstanding
work rather than smuggled into this amendment.

**Incidental fix.** `transformIslandSource` appended its `__island`/`__tagName`
markers to ANY file under the islands directory, including `card.css` — which
corrupted the `.css?inline` text the dev endpoint serves (the markers became
part of the stylesheet). The transform now admits only the script modules the
island scanner admits (`*.ts|tsx|js|jsx`, query/hash stripped), so the two
halves of island admission state one rule.

## Amendment (2026-10-12): production resources and the dev host's delegation (S-C1.3 follow-up)

The S-C1.3 amendment closed dev-vs-build parity for the sheet's TEXT and left
two defects it had named, plus one it had not measured. Both defects are
corrected here, and the dev dual delivery is audited rather than assumed.

**1. The built asset carries Vite-processed bytes.** The client build's emitted
asset used to be the authored file's own bytes, so a relative `url()` inside a
component sheet resolved against the emitted asset's URL (`assets/<hash>.css` →
`assets/<name>`, a 404) and an `@import` survived into a sheet a constructed
`CSSStyleSheet` then refused to parse (`replaceSync` throws on `@import`, so the
SHADOW half of the same sheet died outright). The emission now reads the
authored file through **Vite's own CSS pipeline** — the `?inline` CSS module,
reached in a build through the plugin context (`this.load` + `getModuleInfo`,
the dev server's `transformRequest` equivalent) — with the identical extraction
and scope step the dev endpoint uses (`processedEdgeCss` / `inlineCssModuleText`
/ `scopeEdgeCss`). One processing path, two access paths, one resource: imports
expanded, `url()` targets emitted content-hashed by Vite's asset graph (or
inlined under the configured limit), relative references rewritten, the
project's PostCSS chain applied, and the public base of the client build
respected.

The named files Vite emitted inside that text arrive as Vite's own
`__VITE_ASSET__<referenceId>__` placeholder; Vite resolves those for the CSS it
generates per chunk, and an asset this protocol emits is outside that pass. The
resolution therefore runs in the plugin's `generateBundle`, with the same public
API (`getFileName` — the bundler's file-name mapping, never a second hashing
algorithm) and the same base rule Vite applies to CSS assets (base-absolute
under an absolute base, relative to the CSS asset under a relative one). The
sheet's own file name still derives from the pre-resolution text, and the
placeholder embeds the referenced file's content hash, so the name remains a
faithful content address: two different referenced assets can never produce one
sheet name.

The SSR text shim (the URL-less sheet of a component the client graph never
contains) deliberately keeps the authored bytes: a server build's `url()`
rewriting describes the SERVER output, and that text is parsed by the
document/constructed-sheet consumers. External resource coverage for URL-less
sheets remains #1609's scope.

**2. The dev host strips the public base and delegates the files Vite serves.**
With a non-root `base`, every URL the browser sees is base-prefixed (module
code, the injected Vite client, framework resource links) while the app's
routes, the router's own dev endpoints and Vite's endpoints are written
base-less. Vite's base middleware strips for the middlewares it installs after
itself, and plugin middlewares run before it, so `/sub/@vite/client` was routed
into the application: the module graph never loaded, nothing upgraded, and
`GET /sub/` was not the app. Two middlewares now run immediately before the
application's (after every router-owned endpoint, which stays base-aware):
a base strip derived from Vite's resolved `base` alone, and a delegation of
requests for files Vite serves — an existing asset file under the project root
(`config.assetsInclude`, Vite's own list plus the app's additions, public dir
excluded) is rewritten to Vite's `/@fs/` endpoint, which the dev-server peer's
namespace exclusion already delegates. A pattern list cannot answer "is this
path a file on disk", which is why the peer's `exclude` had no asset entry and
a `.css` `url('./texture.png')` 404'd in dev while its stylesheet arrived.

Inverting the peer's middleware order instead was rejected on measurement:
Vite's HTML fallback middleware REWRITES `req.url` (`/foo` → `/foo/index.html`,
unknown → `/index.html`), so an application middleware running after it receives
the wrong route path.

**3. HMR updates name the path the client registered.** An update payload must
carry the module path Vite's client knows, and that path is the SERVER-side url,
never a base-prefixed variant: under `base: '/sub/'` the client registers
`createHotContext("/@id/__x00__…")` while the browser's own request keeps the
prefix, so a base-prefixed update path matched nothing and was silently dropped
by the update walk — the edit appeared to do nothing. `devClientModulePath`
(internal/dev-client-path.ts) is now the one spelling of that rule for both
emitters (the authored edge in `plugin-hmr.ts`, the utility sheet in
`dev-tailwind-components.ts`, whose payload previously carried the raw
NUL-prefixed id and could never match either).

**4. Dev dual delivery and the realm cache, audited.** In dev a sheet is
declared by a markup `<link>` (the parser-visible first paint, and the whole
delivery without JavaScript) AND adopted as the live `CSSStyleSheet` (the copy
an edit re-fills). The two copies are identical bytes at first paint; after an
edit the link keeps what it parsed (a browser never re-fetches a `<link>` whose
href did not change) while the adopted sheet is the edit — measured, and the
adopted sheet wins the tie, because adopted sheets are ordered after the
document's own sheets. Cascade order, `@layer`, custom properties, media
queries, keyframes and specificity are therefore unaffected by the duplication:
identical declarations on both sides, and on divergence the newer copy is the
authoritative one. The realm store (`globalThis.__openElementDevStyleSheets`)
is the HMR identity store, not a second registry of resources: one entry per
edge digest (so no cross-app or cross-server collision, and two documents of one
realm share the sheet object), a per-evaluation revision that rejects a delayed
stale response, and a fixed size — re-evaluating an edge adds nothing. Both
properties have regressions in the dev suite. No fix was needed; the audit
replaced an assumption with a test.

**Closed (alpha15 Q-CI).** The Tailwind-compiled sheet
(`componentStyleSheetPlugin`) reached its `url()` targets through the official
compiler's own rebasing rather than through Vite's asset graph, so a font
referenced from such a sheet landed as a source-relative path in the emitted
asset — a 404 once the sheet was served from `client/assets/` (the Site's
`@fontsource` faces did exactly that). The build now rebases every relative
`url()` target onto an asset it emits itself (`emitFile`) and resolves a
content-digest placeholder to that asset's URL in `generateBundle` through
Vite's own `getFileName` mapping, under the one URL rule the style-edge sheets
use (`cssAssetUrl`). Emitting the referenced bytes here — rather than joining on
an asset the document pipeline happened to emit — is what covers the
`assetsInlineLimit` case: a small font is inlined into the document sheet and
has no emitted asset to borrow, yet the component sheet must still address a
resource this build owns. Regression:
`packages/router/__tests__/tailwind-component-sheet-urls.test.ts`.

## Amendment (2026-10-12): server-only components join discovery (#1609, S-C1.4)

The S-C1.2 boundary was structural: the client build's graph contains the
islands and only the islands, so a Page, Layout or component the SERVER renders
and no island imports never had its authored `.css` edges registered in that
build. The SSR build registered them, found no emitted asset, and answered with
a framework-generated inline `<style>` written where the component rendered —
outside the document head collection and outside one-resource-one-delivery.

**Discovery is resolver-driven and specifier-complete.** The build already knows
the route/page/layout sources the server renders (the traversal that selects
island delivery); `serverRenderedStyleEdgesPlugin` now walks their static module
graph through the BUNDLER's resolver (`walkModuleGraph`: `this.resolve` with the
importing module, deduplicated by resolved identity, deterministic order,
bounded and reported). Specifiers come from the compiler's own analysis
(`analyzeModuleSemantics`, with `collectSpecifiers` opted in so no other
consumer's facts change). That covers the forms a dot-relative scan cannot see:
`package.json` `imports` subpaths (`#site-ui/open-artifact-panel.tsx` — the
WWW failure that stopped the previous attempt), configured aliases, and package
export paths. Deliberate boundaries are counted, never glossed: `.css` belongs
to the compiler's edge registry, `external` resolutions are the resolver's own
verdict, virtual ids have no file, and a dynamic-only dependency is outside the
static contract — the SSR half diagnoses that case instead of guessing.

**The walk's roots include the SSR entry's island imports (follow-up,
2026-10-12).** Route/page/layout sources are not the whole server-rendered
graph: the generated entry statically imports EVERY SSR-renderable island module
— local and package alike, whether or not a page references the tag — because it
registers each admitted tag so any of them can render in server markup. Such a
module's `.css` edge is therefore loaded by the SSR build, which fails closed at
the lookup when the client build emitted no asset for it. The packed consumer
found exactly that: the appliance rendered three of the installed package's six
declared islands, and `@openelement/ui/open-input`, `…/open-dropdown` and
`…/open-theme-toggle` — imported by the entry, referenced by no page — left three
`OE_CLIENT_BUILD_STYLE_ASSET_UNREGISTERED` failures. The roots are now the union
of the route/layout/traversal files and those island modules (declared islands
∩ the admission plan's renderable set, so a `hydrate: 'only'` island adds
nothing), the island modules as SPECIFIERS the pass resolves exactly as the
entry's own import does. Admission stays resource-level: the asset exists, and a
declarative `<link>` still appears only where a component actually renders.

**Admission and emission reuse the existing owners.** Each discovered module is
handed to the compiler (`compileElementModule`) and its edges recorded through
the registry's one write path, `registerStyleEdges` — now shared with the Vite
transform, so there is still exactly one writer. Every registered edge is then
loaded through `clientStyleAssetPlugin`: the same plugin instance, Vite CSS
processing, content addressing, manifest record and adapters an island's sheet
gets, in the same client build. Modules are read, never imported — no
server-only JavaScript reaches a client bundle and tree shaking cannot drop an
emission that was never an import.

**The URL-addressable fallback is retired.** A registered in-root edge with no
emitted asset THROWS the coded `OE_CLIENT_BUILD_STYLE_ASSET_UNREGISTERED`
diagnostic instead of inlining. The one remaining inline path is explicit: an
out-of-root (package) sheet that never entered a client graph logs a warning
naming the file and the `packageIslands` remedy, because a build that never sees
those modules cannot emit their bytes. A truly URL-less, author-owned in-memory
`CSSStyleSheet` is untouched and unchanged in kind: no file, no edge, no URL —
externalizing it would need a runtime-to-file serialization pipeline this
protocol deliberately does not have.

**Amendment (2026-10-12): the URL-less memory-sheet contract (S-C2/S-10).** The
two sheet classes are split by ONE fact — whether the sheet object carries an
external identity (`STYLE_SHEET_URL`, recorded only by a build/dev adapter). An
author-owned in-memory sheet (or the SSR shim) has none, and then:

- **SSR** serializes its rules verbatim as the marked
  `<style data-oe-static-styles>` text node — the one legitimate inline path,
  author data rather than framework delivery — and never invents an external URL
  for it. A *light* root's URL-less sheet follows the same rule: its bytes are
  the author's, and the renderer has no mandate to scope them.
- **CSR** keeps the standard native semantics: the sheet object is adopted
  through `adoptedStyleSheets` like any other, with no node, no request and no
  second copy.
- **Unreadable** rules (the reachable case is a cross-origin `CSSStyleSheet`
  taken from the document and handed to `static styles`, whose `cssRules` throws)
  are SKIPPED and REPORTED with the catalogued
  `OE_STYLES_SHEET_RULES_UNREADABLE` (phase `ssr`) naming the component — never
  a silent drop, never a render crash, and never a fabricated URL standing in
  for bytes the build does not own.

**Construction ordering is outside this contract (fail-closed).** The SSR
global `CSSStyleSheet` is installed by the generated SSR entry *body*
(`build-ssg.ts`), after ESM import evaluation — only the `customElements` stub
is an output banner, because route modules `define()` at top level. A module
that constructs the sheet through the global at MODULE-EVALUATION time
(`new CSSStyleSheet()` at a module's top level) therefore fails loudly:
`ReferenceError: CSSStyleSheet is not defined`, build exit non-zero, no page
written — never a silent style loss. A module-top-level sheet takes element's
cross-realm `StyleSheet` (statically the Node shim where no global exists), the
spelling the legacy artifact path names.

Consumer form: `packages/element/__tests__/compiled-server/memory-sheet-policy.test.ts`
(the inline text with no `<link>`, the URL-carrying boundary sheet that is linked
and never inlined, and the unreadable sheet's report).
