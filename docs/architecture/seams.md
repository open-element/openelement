# Seams registry

[P8 of the design principles](./design-principles.md#p8--seam-single-ownership)
requires every seam — a boundary where one system writes what another system
reads — to name one owner, to derive what crosses it, and to carry a standing
consumer-form test. The amendment is
[ADR-0163](../adr/ADR-0163-seam-single-ownership.md); this file is the live
registry.

Adding or touching a seam means adding or updating its row and its guard
test in the same change. A row whose guard test has not landed yet is marked
`pending` with the lane that owns it; the row is not compliant until the
guard exists.

| Seam | Owner | Direction | Crossing artifacts | Guard test |
| --- | --- | --- | --- | --- |
| Positioner styles (search combobox) | Zag popper imperative channel (`getPositionerProps()`) | popper → positioner element | `style` attribute: static shell plus `--x` / `--y` / `--reference-width` / `--z-index` | `www/e2e/search.spec.ts` geometry assertions (panel tracks the input's left edge, configured offset below, `sameWidth`) |
| Color truth | `packages/ui` `theme.css` role table | ui theme → site and downstream consumers | role-token custom properties | `@openelement/www#check:theme-tokens` (`www/tools/check-site-theme-tokens.ts`) |
| Preset build-stage artifacts | inner `vite build` | build stage → later stages and consumers | preset build outputs (`.openElement/` build state) | `pending` (#1535 fixture, lane in flight) |
| Tailwind output grammar | Tailwind compiler | generated CSS → templates and runtime consumers | class grammar of the compiled output | `pending` (#1536 fixture, lane in flight) |
| Template ↔ repo hygiene knowledge | repo runtime-artifact inventory (what router dev/build writes into consumer projects, e.g. `.openElement/`) | runtime writes → starter templates | `.gitignore` entries in `packages/create/templates` | template assertions in `packages/create/__tests__/cli.test.ts` |
| Version task ↔ workspace root | version-bump task (`tools/repo/version-bump.ts`) | task → workspace root and member manifests | version strings at the ten stamp sites | version-bump tests including root-level edit points (`tools/repo/version-bump.test.ts`) |
| Element sideEffects declaration | `tools/release/npm-manifest.ts` `SIDE_EFFECTS` | source `packages/element/package.json` (bundler tree-shaking of in-repo source builds) ↔ packed artifact manifest (release pack) | `sideEffects` array naming the claim-install edge (importer + installer, #1425) in `.ts` (source) and `.js` (packed) form | source side: `packages/element/__tests__/side-effects-declaration.test.ts`; packed side: `tools/release/pack-surface.ts` tarball scan (`findUndeclaredSeamInstalls`, metadata equality) |
| Island host ↔ runtime lifecycle | controller state object | host element ↔ runtime controller | lifecycle handoff across a runtime swap (reconnect) | `pending` (#1531 reconnect-form test, lane in flight) |
| Element runtime error-message strip (#1546) | element `protocol/errors.ts` seam constant (`OE_RUNTIME_MESSAGES`, `typeof`-guarded, full-prose default) | router client build (`build-client.ts` Vite `define`) → bundled element runtime | `ELEMENT_RUNTIME_MESSAGES_DEFINE` (`router/vite/internal/element-error-messages.ts`) rewriting the seam constant to `false` in production client bundles | element dev half (no define → full prose): `packages/element/__tests__/compiled-runtime/runtime-messages.test.ts`; router production half (define → prose folded, codes kept): `packages/router/__tests__/element-error-messages.test.ts` |
| Modal declaration ↔ runtime readiness | controller open sequence | declarative modal → runtime controller | open/readiness handoff | `pending` (#1533 keyboard-form test, lane in flight) |
| Island CSS shipped bytes (#1543) | `router/vite/internal/island-css.ts` `minifyIslandCssModule` via the client build's `open:minify-island-css` post transform | client build transform → shipped island chunk bytes | component-stylesheet formatting inside island chunk JS (template-literal content the oxc minifier leaves verbatim) | transform contract: `packages/router/__tests__/island-css-pipeline.test.ts`; end-to-end byte figures: `@openelement/www#check:doc-figures` |
| Element-runtime shared chunk layout (#1544) | `router/vite/internal/element-runtime-chunk.ts` grouping identity (`elementRuntimeChunkName` fed by the build's resolver-anchored identity pass, `requireElementRuntimeChunk` fail-closed guard) | client build module graph → emitted chunk layout | the single shared `element-runtime-<hash>.js` chunk that `client.js` and every island chunk statically import | grouping/identity contract: `packages/router/__tests__/element-runtime-chunk.test.ts`; emitted layout: `www/__tests__/build-output.test.ts` (www vitest project, after `site:build`) |
