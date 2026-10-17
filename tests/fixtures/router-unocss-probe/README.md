# router-unocss-probe

The acceptance fixture for alpha15 stage 2B: **a real second utility engine,
selected by declaration, replacing the first without touching the core.**

## What it proves

| fact | where it is measured |
| --- | --- |
| the engine is UnoCSS, reached through its own public API (`createGenerator`, the official config loader, `presetWind4`, the generator's own extractors) | `packages/router/__tests__/style-provider.test.ts` |
| the theme source is Open Props — a token package with no relationship to any utility generator — inlined into the document sheet with its `@import` resolved | same, plus `app/styles/tokens.css` |
| the component sheet compiles admitted `tailwind4`-dialect tokens and reaches inside the declarative shadow root | `e2e/probe.spec.ts` (computed styles) |
| the document sheet compiles the light-root page's admitted tokens and the token source's own variables are what they resolve to | `e2e/probe.spec.ts` (computed styles) |
| the application's own `uno.config.ts` is the engine's configuration, loaded and used verbatim | build artifacts + the unit suite |
| declaring a provider the package's dialect requires is what selects an engine; both keys at once fails closed | the unit suite |
| a `@theme` source (Tailwind's language) under UnoCSS fails closed instead of dropping roles | the unit suite |

## Layout

- `openelement.config.ts` — `unocss: { theme: ['app/styles/tokens.css'] }`.
- `uno.config.ts` — the application's UnoCSS configuration (presets, the
  role→variable map). The router loads it through the official loader and never
  re-interprets it.
- `app/styles/tokens.css` — Open Props plus the role table this app's
  components name.
- `app/islands/probe-unocss-card.tsx` — a shadow-root component whose control
  surface is authored as utility class tokens.
- `app/components/probe-page.tsx` — a light-root page whose class tokens belong
  to the document sheet.
- `e2e/` — the built artifact read in Chromium, Firefox and WebKit.

## Commands

```sh
pnpm --dir tests/fixtures/router-unocss-probe run build
pnpm --dir tests/fixtures/router-unocss-probe run e2e:browsers
pnpm --dir tests/fixtures/router-unocss-probe run gate
```
