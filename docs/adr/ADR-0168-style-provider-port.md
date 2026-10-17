# ADR-0168: The style provider port — one utility engine per application, selected by declaration

- Status: ACCEPTED (implemented: `packages/router/src/vite/internal/style-plan.ts`,
  `style-provider.ts`, `style-provider-port.ts`, `providers/tailwind.ts`,
  `providers/unocss.ts`, `generated-sheets.ts`)
- Decided: 2026-10-14 (alpha15 stage 2B)
- Extends: ADR-0167 (declared compilation). ADR-0167's decisions — demand is a
  PACKAGE fact, the document reset is an APPLICATION fact, no engine grammar in
  the framework — are unchanged; this ADR says WHICH engine compiles and where
  the line between core and engine runs.
- Supersedes nothing. The `tailwind` key, its resolution rules, the emitted
  entry's shape and every delivered artifact are unchanged; `unocss` is a
  sibling with the same shape.

## Context

ADR-0167 made the utility compile a declared dependency, and the alpha15 S lane
implemented it against exactly one engine, Tailwind 4, through the official
`@tailwindcss/vite` plugin (document sheet) and `@tailwindcss/node` (component
sheet). "Replaceable" was a claim with one implementation behind it, so it was
unproven: the document sheet's only writer was `findClientEntryStyles`, which
reads Vite's CSS manifest, and that reader only sees a CSS module Vite's own
pipeline compiled.

The two engines genuinely differ, and the difference is not cosmetic:

| | Tailwind | UnoCSS |
|---|---|---|
| document sheet | CSS entry text compiled inside the Vite graph by `@tailwindcss/vite` | CSS text produced by a JS pipeline (`createGenerator`) |
| component sheet | `@tailwindcss/node`'s `compile()` → `build(candidates)` | `generator.generate(candidates)` |
| declaration | `@theme` blocks in imported CSS sources | `uno.config.ts` (presets, theme, shortcuts) |
| source detection | the peer's own scanner over the project root | the generator's own extractors over given text |

Pretending those are one shape would be a rename, not a port. So the port
states the asymmetry instead of hiding it.

## Decision

**1. One engine per build, selected by declaration, checked against a closed
support table.**

```ts
tailwind?: boolean | { theme?: string[] }   // default engine; unchanged
unocss?:   boolean | { theme?: string[]; config?: string }
```

Declaring both is `OE_PRESET_STYLE_PROVIDER_CONFLICT` — the entry has one
compiling engine and the winner must never depend on key order. Neither
declared plus an admitted requirement enables the DEFAULT engine (Tailwind),
which is the pre-2B behaviour, byte for byte.

**2. The declaration is provider-neutral; the dialect is the compatibility
axis.** A package manifest declaration keeps stating WHAT its components need
(`required`, `sources`) and gains `dialect` (default `tailwind4`: the language
every first-party component's class tokens are written in). It never names a
provider. A requirement whose dialect the selected provider does not implement
fails with `OE_PRESET_STYLE_DIALECT_UNSUPPORTED` BEFORE any compile, naming
package, tag, dialect and provider.

**3. The port is four facts wide.** What the core owns:

- the DECLARED demand and the resolved plan (engine, sources, document reset,
  dialect);
- the opaque class candidates its compiler collected, each carrying the root
  scope it was admitted in. The COMPONENT sheet takes them all (`all()`): a
  light-root class can render inside a shadow tree — the layout convention puts
  every page inside the layout's shadow template — where the document sheet
  cannot reach it. A generated DOCUMENT sheet takes the light ones
  (`allLight()`), because a shadow component's classes are delivered by the
  component sheet and must not inflate the document one;
- the module texts its own graph walk read, offered to a provider whose
  extractors consume source;
- DELIVERY: content-addressed emission, the fetch adapter, the DSD marked link,
  the head link, dev-serving and HMR.

What a provider owns: utility syntax, source interpretation, configuration,
compilation and output shape. `StyleProvider` is the whole contract
(`documentDelivery`, `compileComponents`, `compileDocument?`, `watchFiles`, the
two sheet identities). There is no registry, no lookup, no capability
negotiation and no global singleton: `createStyleBuildIntegration` is a switch
on a two-value union, and an unselected engine is never imported, so it cannot
reach a build or a browser bundle.

**4. Two document deliveries, one destination.** `documentDelivery:
'graph-entry'` means the provider contributes a CSS entry module plus the
plugins that compile it, and Vite's CSS pipeline emits the asset (Tailwind,
unchanged). `'generated'` means the provider returns the sheet text and the
framework's existing content-addressed emitter — extracted from the Tailwind
component-sheet plugin into `generated-sheets.ts`, one implementation for both
engines — emits it (UnoCSS). Both deliveries end in `ctx.clientStyleAssets` and
one `<link>` in every document head.

**5. UnoCSS is reached through its own public API.** `unocss`'s
`createGenerator`, `@unocss/config`'s `loadConfig` (the loader the official CLI
and Vite plugin use), the official `presetWind4`, and the generator's own
`applyExtractors`. The framework writes no utility grammar, mocks no compiler
and hardcodes no CSS. The peer resolves from the APPLICATION's tree, so a packed
consumer's own install is what runs.

**6. The reset policy lives where each engine puts it, and is stated.**

- Tailwind (`graph-entry`): the entry text carries it — the reduced entry in
  automatic mode, `@import 'tailwindcss'` when the application declared it.
- UnoCSS with the framework's preset (the project carries no preset set): the
  framework installs `presetWind4({ preflights: { reset: plan.documentReset } })`.
- UnoCSS with the project's OWN `uno.config.ts`: that configuration is the
  application's own provider policy, so its preset set — including its preflight
  policy — is used verbatim. The framework's guarantee is that IT introduces no
  reset; an application that ships a reset has asked for one.

**7. Theme sources are independent of the utility generator.** `theme` sources
are plain CSS, inlined verbatim with their `@import`s resolved through the
platform resolver (bare specifiers from the app root, relative ones against
their importer). Open Props, a package's `:root` block or a hand-written table
are equally valid: the token package owns the values, the provider's `theme`
map owns the role→variable join, and swapping either changes nothing in the
framework. A source carrying Tailwind's `@theme` at-rule — which UnoCSS does
not compile — fails with `OE_PRESET_UNOCSS_THEME_SOURCE_INCOMPATIBLE` rather
than dropping the roles silently.

**8. Reserved to the application, not the framework:** the framework's inline
token convention (`styles.tokens`, default `styles/tokens.css`) and a declared
engine theme source may not be the same file. A file the application's style
entry declares is compiled by the engine, so the convention skips it — one
owner per token file, and engine source syntax (`@theme`, bare `@import`s) is
rejected by the inline `<style>` channel anyway.

## Consequences

- THE CLASS DIALECT IS PORTABLE; `@openelement/ui` IS NOT SELECTABLE UNDER
  UNOCSS TODAY. Its components author `tailwind4`-dialect tokens and both
  providers implement that dialect, so the class tokens themselves are
  engine-neutral. But the package also DECLARES its role table
  (`openElement.tailwind.sources: ['./src/theme.css']`), and that file is a
  Tailwind `@theme` source: an application that selects `unocss` and admits
  `@openelement/ui` fails closed at plan time with
  `OE_PRESET_UNOCSS_THEME_SOURCE_INCOMPATIBLE`, naming the source. The
  alternative — dropping the declared roles — is the silent half-styling this
  contract exists to prevent. An application that wants both ships its own
  role table in `uno.config.ts`'s `theme` key AND stops admitting the package's
  theme source; no shipped mechanism performs that substitution today, so the
  supported answer is the coded refusal, not a claim of parity.
- What IS qualified on real artifacts is the PROVIDER SUBSTITUTION itself: the
  same fixture app builds and is measured in Chromium, Firefox and WebKit under
  either engine (`tests/fixtures/router-unocss-probe`), and its document +
  component sheets come from the selected engine's own compiler. That fixture
  consumes the workspace router and a token source it owns; it does not consume
  `@openelement/ui`, so it is not evidence about the package.
- A provider that does not implement a required dialect is a build failure, not
  a half-styled component.
- The framework's Tailwind paths are untouched: the same entry text, the same
  peer, the same emitted artifacts. The extraction of `generatedSheetsPlugin`
  moved code; it changed no output.
- Adding a third engine is a product decision with a real adapter and a real
  consumer — not a registry entry.
- NOT provided, and not claimed: a per-engine equivalent of every Tailwind-only
  configuration surface (`@source inline()`, Tailwind plugin config), or
  cross-engine identical bytes. The port is about the framework's boundary, not
  about the engines becoming each other.

## Evidence

- `packages/router/__tests__/style-provider.test.ts` — plan semantics (conflict,
  default engine, `false` authority, dialect rejection) plus the adapter's real
  output: role variables preserved, opacity modifiers as colour mixes, variants,
  arbitrary values, no reset in a shadow sheet, the theme layer present in the
  reduced document sheet, source extraction through the engine's own extractors,
  the `@theme` refusal and the coded missing-peer failure.
- `packages/router/__tests__/tailwind-declared-demand.test.ts` — the ADR-0167
  matrix, unchanged and still green.
- `tests/fixtures/router-unocss-probe` — the packed acceptance: build artifacts
  asserted in the unit tests, computed styles in three engines in `e2e/`.
