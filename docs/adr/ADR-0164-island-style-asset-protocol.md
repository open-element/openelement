# ADR-0164: Island style asset protocol — extracted sheets, dual adapters, three-owner seam split

- Status: PROPOSED (Lane 1 of #1553 — decision record + capability spike;
  production lanes implement toward this shape)
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
