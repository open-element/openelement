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
| Island host ↔ runtime lifecycle | controller state object | host element ↔ runtime controller | lifecycle handoff across a runtime swap (reconnect) | `pending` (#1531 reconnect-form test, lane in flight) |
| Modal declaration ↔ runtime readiness | controller open sequence | declarative modal → runtime controller | open/readiness handoff | `pending` (#1533 keyboard-form test, lane in flight) |
