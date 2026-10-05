# Customizing @openelement/ui

This document is the package's **customization surface declaration** (alpha9
C3, #1506). It lists, per component, the shadow parts (`::part(...)`) and the
CSS custom properties the recipes consume. A test guard
(`__tests__/customization-surface.test.ts`) pins both lists to the code and
to the 1.0.0-alpha.8 baseline.

## Semver contract

- **`::part` names never shrink.** Every part shipped in 1.0.0-alpha.8 exists
  today and must exist in every later release; adding a part is allowed.
- **Consumed variables are pinned at the C3 role-direct baseline.** Adding or
  removing a `var()` reference in a recipe is a deliberate surface change: the
  guard fails until the pin and this document are updated in the same change.
- Component internals carry **no utility classes** — the role variables are
  the entire styling contract.

## Theming model

Components read the shadcn-convention role table in
[`src/theme.css`](./src/theme.css) directly: `--color-*` semantic roles seated
on the Tailwind v4 default scale. There is no intermediate alias layer — the
C1 alias sheet (`semantic-tokens.css`) was deleted in C3 under its own
DELETION CONDITION.

- **Light/dark**: the roles carry `[data-theme='dark']` pairs re-pointed at
  this repo's theme mechanism (`:root[data-theme='dark']`,
  `:host([data-theme='dark'])`). Components flip automatically.
- **Forced colors** (Windows High Contrast): the `forced-colors: active`
  tier in `theme.css` re-seats **every** role on a system color
  (`Canvas`, `CanvasText`, `ButtonFace`, `ButtonText`, `GrayText`,
  `Highlight`, `LinkText`, `Mark`) in both selector blocks. Every component
  therefore resolves fully under forced colors; hue carries no meaning there,
  so status is also encoded by border and label, never by color alone.
- **Delivery**: see the [Value delivery](#value-delivery) section below.

## Value delivery

**What the ui package guarantees is the role table's SHAPE, not its values.**
The contract a consumer may rely on:

- the role names declared in the `@theme` block of
  [`src/theme.css`](./src/theme.css) (the full inventory below),
- each role's `[data-theme='dark']` dark pair,
- the `forced-colors: active` tier that re-seats every role on a system color.

**The package carries no scale values of its own.** Since the alpha9 C5 twin
removal, `@openelement/ui` embeds no compiled value table and exports no
token module — the retired `@openelement/ui/theme-tokens`
(`themeTokenCss` / `themeTokenSheet`) is gone. Component recipes reference
`var(--color-*)` / `var(--spacing)` / etc.; until the host supplies those
variables the recipes resolve to nothing. Values have exactly two suppliers:

- **Preset ON**: a `@openelement/router` Tailwind build compiles
  `theme.css` through the preset (`tailwind: { theme:
  ['@openelement/ui/theme.css'] }`), emitting the roles plus Tailwind's own
  scale layer. This is the first-party delivery (the www site and the
  router-ui-dogfood fixture).
- **Preset OFF**: the consumer writes its own table. The only requirement is
  that it defines the role names (and any scale variables the recipes
  consume, e.g. `--spacing`, `--radius-md`) under the same selectors.
  Minimal shape, values illustrative:

  ```css
  /* OFF-state table — role names from src/theme.css are the contract;
     the values are the consumer's own. */
  :root,
  :host {
    --color-background: white;
    --color-foreground: black;
    --color-primary: rebeccapurple;
    --color-primary-foreground: white;
    /* …the remaining --color-* roles of src/theme.css… */
    --spacing: 0.25rem;
    --radius-md: 0.375rem;
  }
  :root[data-theme='dark'],
  :host([data-theme='dark']) {
    /* the same roles, dark-side values */
  }
  ```

The full role-name inventory is the `@theme` block of
[`src/theme.css`](./src/theme.css): `--color-background`, `--color-foreground`,
`--color-card(-foreground)`, `--color-popover(-foreground)`,
`--color-primary(-foreground)`, `--color-secondary(-foreground)`,
`--color-muted(-foreground)`, `--color-accent(-foreground)`,
`--color-destructive(-foreground)`, `--color-success`, `--color-warning`,
`--color-info`, `--color-border`, `--color-input`, `--color-ring`, and
`--color-chart-1` … `--color-chart-5`.

## alpha8 → C3 variable rename map

The retired alias names are gone. The notable re-seats (consumers renaming
their overrides):

| Retired (alpha8)  | C3 role expression                                        |
| ----------------- | --------------------------------------------------------- |
| `--bg-base`       | `--color-background`                                       |
| `--bg-card`       | `--color-card`                                             |
| `--bg-elevated`   | `--color-popover`                                          |
| `--bg-surface`    | `--color-muted`                                            |
| `--text-primary`  | `--color-foreground`                                       |
| `--text-secondary`| `--color-muted-foreground`                                 |
| `--text-muted`    | `--color-muted-foreground` (one ink step since C1)         |
| `--brand`         | `--color-primary`                                          |
| `--on-brand`      | `--color-primary-foreground`                               |
| `--border`        | `--color-border`                                           |
| `--error`         | `--color-destructive`                                      |
| `--success`       | `--color-success` (new role, same AA-tuned values)         |
| `--warning`       | `--color-warning` (new role, same AA-tuned values)         |
| `--info`          | `--color-info` (new role, same AA-tuned values)            |
| `--focus-ring`    | `--color-ring`                                             |
| `--bg-code`       | static `--color-zinc-950` (code surfaces stay dark)        |
| `--code-text`     | static `--color-zinc-200`                                  |
| `--code-border`   | static `--color-zinc-700`                                  |
| `--size-N`        | `calc(var(--spacing) * N)`                                 |
| `--radius-1/2/3`  | `--radius-md` / `--radius-lg` / `--radius-xl`              |
| `--radius-round`  | `calc(infinity * 1px)`                                     |
| `--font-size-0..3`| `--text-sm` / `--text-base` / `--text-xl` / `--text-2xl`   |
| `--font-weight-N` | `--font-weight-medium` … `--font-weight-black`             |
| `--motion-fast`, `--duration-2` | `--default-transition-duration` (150ms)      |
| `--ease-3`, `--motion-standard` | `--ease-out`                                 |
| `--ease-2`        | `--ease-in-out`                                            |

Deliberate pixel breaks to note (this is C3's contract, not a migration):

- `--brand-deep` (static violet-950) became a 50/50 primary/foreground mix —
  the default-button hover ink now tracks the theme's ink side.
- `--violet-0/1/2/5/8/10` re-seat on flipping roles
  (primary-foreground/secondary/border/ring/primary/secondary-foreground), so
  coordinated surfaces (e.g. the site's flood panels) invert together with
  the theme instead of mirroring a fixed ramp.
- Badge/callout washes are computed inline (`color-mix(... 10%, transparent)`)
  from each status role; the light-theme rgba tint overrides are gone.
- Card `artifact`, code-block and dialog backdrop keep static zinc surfaces
  in both themes (the retired sheet's behavior, now explicit literals-free
  ramp references).

## Per-component surface

Variables listed are the ones each component's recipe **consumes**; all of
them resolve from the role table above. There are no component-defined
custom properties.

### `open-badge`

- Parts: `badge`
- Variables: `--color-border`, `--color-info`, `--color-muted`,
  `--color-muted-foreground`, `--color-primary`, `--color-success`,
  `--color-warning`, `--font-mono`, `--font-weight-extrabold`,
  `--leading-normal`, `--radius-md`, `--spacing`, `--text-xs`
- Tones `brand/success/warning/info` paint their 10% wash with `color-mix`
  off the matching role; AA is asserted against base and wash in the suite.

### `open-button`

- Parts: `control`
- Variables: `--color-border`, `--color-foreground`, `--color-popover`,
  `--color-primary`, `--color-primary-foreground`, `--color-ring`,
  `--color-violet-400`, `--color-white`, `--default-transition-duration`,
  `--ease-out`, `--font-sans`, `--font-weight-extrabold`, `--radius-md`,
  `--shadow-sm`, `--spacing`, `--text-base`, `--text-sm`, `--text-xl`
- Shares the control recipe (below). Variant `primary`/`accent` fill with
  `--color-primary` over `--color-primary-foreground`.

### `open-callout`

- Parts: `container`, `icon`, `content`
- Variables: `--color-destructive`, `--color-foreground`,
  `--color-muted-foreground`, `--color-primary`, `--color-success`,
  `--color-warning`, `--font-weight-semibold`, `--leading-relaxed`,
  `--radius-lg`, `--spacing`, `--text-base`, `--text-sm`
- Types `info/warning/danger/tip` map to primary/warning/destructive/success
  inks with 10% washes; the alpha8 light-theme rgba overrides are gone (the
  roles' dark pairs carry the flip).

### `open-card`

- Parts: `container`, `body`
- Variables: `--color-border`, `--color-card`, `--color-foreground`,
  `--color-muted`, `--color-muted-foreground`, `--color-primary`,
  `--color-secondary`, `--color-zinc-200`, `--color-zinc-700`,
  `--color-zinc-950`, `--default-transition-duration`, `--ease-out`,
  `--font-weight-semibold`, `--radius-md`, `--spacing`, `--text-sm`,
  `--text-xl`
- Variant `artifact` paints a static zinc-950 panel in both themes.

### `open-code-block`

- Parts: `copy`
- Variables: `--color-destructive`, `--color-primary`, `--color-zinc-200`,
  `--color-zinc-700`, `--color-zinc-950`, `--default-transition-duration`,
  `--ease-in-out`, `--font-mono`, `--font-sans`, `--font-weight-bold`,
  `--font-weight-semibold`, `--leading-relaxed`, `--radius-lg`,
  `--radius-md`, `--spacing`, `--text-sm`, `--text-xs`, `--tracking-wider`,
  `--tracking-widest`
- The Prism token palette is static (GitHub-dark-derived hexes measured on
  the static zinc surface); it is deliberately not token-driven.

### `open-dialog`

- Parts: `overlay`, `header`, `close`, `body`, `footer`
- Variables: `--color-border`, `--color-foreground`,
  `--color-muted-foreground`, `--color-popover`, `--color-primary`,
  `--color-white`, `--color-zinc-950`, `--font-sans`,
  `--font-weight-semibold`, `--leading-normal`, `--leading-tight`,
  `--radius-md`, `--radius-xl`, `--shadow-2xl`, `--spacing`, `--text-base`,
  `--text-xl`
- Shares the overlay recipe (below); the backdrop composes the zinc-950
  scrim in both themes.
- Entry and exit animate through `transition-behavior: allow-discrete` +
  `@starting-style` (no keyframes, no JS timing); under
  `forced-colors: active` and `prefers-reduced-motion: reduce` the
  transitions collapse and the dialog opens/closes immediately.

### `open-dropdown`

- Parts: `trigger`, `content`
- Variables: `--font-sans`, `--spacing`
- Shares the overlay recipe for the popover surface.

### `open-input`

- Parts: `wrapper`, `label`, `control`, `error`
- Variables: `--color-border`, `--color-destructive`, `--color-foreground`,
  `--color-muted`, `--color-muted-foreground`, `--color-popover`,
  `--color-primary`, `--color-violet-400`, `--font-sans`,
  `--font-weight-medium`, `--radius-md`, `--spacing`, `--text-base`,
  `--text-sm`, `--text-xs`, `--tracking-normal`
- Shares the control recipe; error/invalid states use
  `--color-destructive`.

### `open-tabs`

- Parts: none (light-DOM decoration pattern; the tabs/panels stay in the
  page's DOM, styled through inherited roles)
- Variables: `--color-border`, `--color-foreground`,
  `--color-muted-foreground`, `--color-primary`, `--spacing`

### `open-theme-toggle`

- Parts: `toggle`, `icon-sun`, `icon-moon`
- Variables: `--color-background`, `--color-border`, `--color-foreground`,
  `--color-muted-foreground`, `--color-popover`, `--color-primary`,
  `--color-ring`, `--color-violet-400`, `--default-transition-duration`,
  `--ease-in-out`, `--spacing`

### Shared recipes (`component-recipes.ts`)

- `controlRecipe` (`.control`): `--color-border`, `--color-foreground`,
  `--color-popover`, `--color-primary`, `--color-ring`, `--color-violet-400`,
  `--color-white`, `--default-transition-duration`, `--ease-out`,
  `--radius-md`, `--spacing`
- `surfaceRecipe` (`.surface`) adds: `--color-card`, `--radius-lg`,
  `--shadow-2xl`
- `overlayRecipe` (`.overlay`) adds: `--radius-xl`

## Deep customization

`::part()` reaches every interactive element. Beyond parts, recolor by
overriding the **roles** on `:root` (light), `:root[data-theme='dark']`
(dark), or inside the `forced-colors` media query — never by redefining
component internals. Example:

```css
:root {
  --color-primary: oklch(54.1% 0.281 293.009); /* re-brand every component */
}
```
