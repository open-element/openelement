# Customizing @openelement/ui

The supported CSS customization surface is the per-component list of shadow
parts and consumed custom properties below. Select a published part with
`::part()` to style one component. Set semantic color roles at the document or
theme scope to change related components together.

```css
open-button::part(control) {
  border-radius: 999px;
}
```

Component sheets and utility classes both resolve colors from the declared
role table. Internal selectors belong to the component's markup and sheets.
The package tests pin the published parts and consumed variables and check
the generated utilities against the documented role table.

## Theming model

Components read the shadcn-convention role table in
[`src/theme.css`](./src/theme.css) directly: `--color-*` semantic roles seated
on the Tailwind v4 default scale.

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

Component recipes read values from the CSS variables supplied by the selected
stylesheet delivery path.

- **Entry ON**: a `@openelement/router` Tailwind build compiles
  `theme.css` through the official `@tailwindcss/vite` pipeline
  (`tailwind: { theme: ['@openelement/ui/theme.css'] }`), emitting the roles
  plus Tailwind's own scale layer into the head-linked document stylesheet.
  This is the first-party delivery (the www site and the router-ui-dogfood
  fixture).
- **Entry OFF**: the consumer writes its own table. The only requirement is
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
`--color-muted`, `--color-muted-foreground`, `--color-accent(-foreground)`,
`--color-destructive(-foreground)`, `--color-success`, `--color-warning`,
`--color-info`, `--color-border`, `--color-input`, `--color-ring`, and
`--color-chart-1` … `--color-chart-5`.

### Style providers

This package's components author their control surfaces as **`tailwind4`-dialect
utility tokens** and declare exactly that in their manifest entries
(`openElement.tailwind.dialect: 'tailwind4'`, the default). The declaration
names the class LANGUAGE, never an engine: it is what makes the components
portable to any provider that implements the dialect.

- **Tailwind 4** implements it natively — the first-party default
  (`tailwind: { theme: ['@openelement/ui/theme.css'] }`).
- **UnoCSS** implements the dialect through its official `presetWind4`, but
  THIS PACKAGE IS NOT SELECTABLE UNDER IT TODAY. An application that selects
  `unocss` and admits `@openelement/ui` fails closed at plan time with
  `OE_PRESET_UNOCSS_THEME_SOURCE_INCOMPATIBLE`, because the package's declared
  role table is the `@theme` source below. Being portable in class tokens is
  not the same as being selectable with this package's theme source, and the
  framework does not substitute one for the other: the coded refusal is the
  supported answer until a shipped mechanism lets an application point an
  UnoCSS build at a plain-CSS role table for this package.
- A provider that does NOT implement `tailwind4` fails the build
  (`OE_PRESET_STYLE_DIALECT_UNSUPPORTED`) before anything compiles — a
  component is never delivered half-styled.

Because `theme.css` is a Tailwind `@theme` source, it is a **Tailwind** engine
source, not a portable one. Under UnoCSS the same roles would come from a
plain-CSS token file the application owns (Open Props, its own `:root`
table, …); the role NAMES in this document stay the contract either way. The
router refuses a `@theme` source under UnoCSS
(`OE_PRESET_UNOCSS_THEME_SOURCE_INCOMPATIBLE`) rather than silently dropping
the roles it declares — which is why the combination above is refused instead
of half-styled.

## Per-component surface

Variables listed are the ones each component's recipe **consumes**; all of
them resolve from the role table above. There are no component-defined
custom properties.

### `open-button`

- Parts: `control`
- Variables: `--color-border`, `--color-foreground`, `--color-popover`,
  `--color-primary`, `--color-primary-foreground`, `--color-violet-400`,
  `--color-white`, `--default-transition-duration`, `--ease-out`,
  `--shadow-sm`, `--spacing`, `--text-base`, `--text-sm`, `--text-xl`
- The base treatment (inline flex box, gap, typography, radius, cursor,
  white-space), the focus ring and the disabled / aria-disabled states are
  authored as Tailwind utilities. The sheet keeps the host
  box, the `[hidden]` rule, the size and variant surfaces (host-attribute
  scoped: the utility spelling exists — `[:host([size='sm'])_&]:p-1` compiles —
  and costs ≈6.5× the bytes for the same branches; see
  [Why the residue is CSS](#why-the-residue-is-css)), the derived base surface,
  and the form-associated disabled state. Variant `primary`/`accent` fill with
  `--color-primary` over `--color-primary-foreground`.

### `open-code-block`

- Parts: `copy`
- Variables: `--color-destructive`, `--color-success`
- The chip's presentation is authored as Tailwind utilities;
  the sheet keeps the host box and the `:state(copied)` / `:state(failed)`
  feedback, which paint the two status roles above.
- Since #1552 the component owns the copy chip only: the code surface and the
  token inks belong to the host's build-time highlight pipeline and its
  stylesheet, so the former Prism-derived token palette and surface variables
  left the pinned surface in the same deliberate edit.

### `open-dialog`

- Parts: `overlay`, `header`, `close`, `body`, `footer`
- Variables: `--color-border`, `--color-foreground`, `--color-popover`,
  `--color-primary`, `--color-white`, `--color-zinc-950`, `--shadow-2xl`,
  `--spacing`
- The dialog box and the header / title / close / body / footer presentation
  are authored as Tailwind utilities. The sheet keeps the
  host box, the trigger slot's cursor, the derived frame (a
  foreground/border/primary triple mix) and the close button's hover wash.
- Shares the overlay recipe (below); the backdrop composes the zinc-950
  scrim in both themes.
- Entry and exit animate through `transition-behavior: allow-discrete` +
  `@starting-style` (no keyframes, no JS timing); under
  `forced-colors: active` and `prefers-reduced-motion: reduce` the
  transitions collapse and the dialog opens/closes immediately.

### `open-dropdown`

- Parts: `trigger`, `content`
- Variables: `--spacing` (the anchor-positioning block's gap; the rest of the
  content's presentation is authored as Tailwind utilities) and
  `--oe-dropdown-anchor` (the component's own runtime anchor identity — the
  activation writes the realm-unique anchor name here, and the authored
  `.content { position-anchor: var(--oe-dropdown-anchor) }` reads it. It is an
  internal wiring property, not a theme token; overriding it re-points the
  popover's anchor.)
- Shares the overlay recipe for the popover surface.

### `open-input`

- Parts: `wrapper`, `label`, `control`, `error`
- Variables: `--color-border`, `--color-destructive`, `--color-muted`,
  `--color-popover`, `--color-primary`, `--color-violet-400`, `--spacing`
- The wrapper layout, the label's typography, the control's box (width,
  padding, font, radius, transition, outline) and the error message's ink are
  authored as Tailwind utilities. The sheet keeps the host
  box, the control's derived surfaces (the popover/border mixes, the violet
  hover border, the focus ring's box-shadow) and the disabled / invalid
  treatments scoped to the host's form state; those states use
  `--color-destructive`.

### `open-theme-toggle`

- Parts: `toggle`, `icon-sun`, `icon-moon`
- Variables: `--color-background`, `--color-border`, `--color-popover`,
  `--color-primary`, `--color-violet-400`, `--spacing`
- The button's element-level presentation (flex box, size, radius, cursor,
  ink, focus ring, transition) is authored as Tailwind utilities; the sheet keeps the derived surface, its hover values and the
  `[data-theme]` icon display swap.

### Shared recipes (`component-recipes.ts`)

- `surface-recipe.css` (`.surface`): `--color-border`, `--color-card`,
  `--color-foreground`, `--color-popover`, `--color-primary`, `--color-white`,
  `--radius-lg`, `--shadow-2xl`, `--spacing`
- The button and input control surfaces combine utilities with each component's
  own stylesheet. The shared surface and overlay recipes own their respective
  shared treatments.
- `overlay-recipe.css` (`.overlay`) adds: `--radius-xl`

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
