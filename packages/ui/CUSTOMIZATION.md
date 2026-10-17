# Customizing @openelement/ui

This document is the package's **customization surface declaration** (alpha9
C3, #1506). It lists, per component, the shadow parts (`::part(...)`) and the
CSS custom properties the recipes consume. A test guard
(`__tests__/customization-surface.test.ts`) pins both lists to the code and
to the 1.0.0-alpha.8 baseline.

## Semver contract

- **`::part` names never shrink.** Every part shipped in 1.0.0-alpha.8 exists
  today and must exist in every later release, for every component that still
  ships; adding a part is allowed. (`open-card`, `open-callout`, `open-badge`
  and `open-tabs` left the package under the Alpha disclaimer and are no
  longer part of this contract.)
- **Consumed variables are pinned at the C3 role-direct baseline.** Adding or
  removing a `var()` reference in a recipe is a deliberate surface change: the
  guard fails until the pin and this document are updated in the same change.
- Component internals are authored as **Tailwind utilities** wherever a class
  utility is the clearest form. The compiler admits every static class token and
  the build's shadow component stylesheet (theme + utilities) carries the
  generated rules into the component's shadow root. What stays in the
  component's `.css` sheet is what reads better as one owned rule — see
  [Why the residue is CSS](#why-the-residue-is-css). **This makes a Tailwind
  entry a requirement of the consuming app** (`tailwind: { theme: [...] }` in
  `openelement.config.ts` — the scaffold's single default form): without it the
  component stylesheet is not emitted and the utilities are not delivered. That
  is the MANUAL path. A package that declares its own requirement admits the
  entry by itself in automatic mode — this package does exactly
  that, which is why a consumer that admits `@openelement/ui` needs no
  `tailwind` key at all.
- Colours still come from this role table, never from a literal — either a role
  variable in the sheet or a utility generated from a role (`bg-primary/14`
  compiles to `color-mix` on `--color-primary`). The guard fails on a raw
  colour literal in a declaration, because a literal escapes the light, dark
  and forced-colors seats the roles guarantee.

### Why the residue is CSS

An earlier revision of this document and of the component sheets said the
retained rules "cannot be a class utility": a utility could not select the
host's attribute from inside the shadow root, the compiler admitted only
two-branch conditionals, and `color-mix` over role pairs was out of reach. That
is **not true of the official engine**, and it is not a good reason to keep
anything. Measured with the installed `tailwindcss` (the same compiler the build
mounts), every one of those shapes has a real utility spelling:

| Shape | Utility spelling | Compiles to |
|---|---|---|
| host attribute | `[:host([size='sm'])_&]:p-1` | `:host([size='sm']) .[…]\/\:p-1 { padding: var(--spacing) }` |
| form-associated state | `[:host(:state(invalid))_&]:border-destructive` | `:host(:state(invalid)) .[…]\/\:border-destructive { border-color: var(--color-destructive) }` |
| derived role mix | `bg-[color-mix(in_srgb,var(--color-popover)_78%,transparent)]` | the mix, with `var(--color-popover)` kept in the supported branch |
| pseudo-class | `focus:border-primary` | `.focus\:border-primary:focus { border-color: var(--color-primary) }` |

What the residue actually rests on is **readability and size**, measured on
open-button's size matrix rather than asserted:

- the retained sheet block: **444 bytes**;
- the equivalent utilities: **998 bytes** of class attribute — the same tokens
  are needed on both rendered controls (the anchor branch and the button
  branch) — plus **1,881 bytes** of generated rules, each selector a mangled
  escape (`:host(:not([size])) .\[\:host\(\:not\(\[size\]\)\)_\&\]\:min-h-\[38px\]`);
- total **≈ 6.5×**, for the same three branches.

There is no capability limit left to claim. The transition configuration this
document used to call one — `@starting-style` and
`transition-behavior: allow-discrete` — is expressible too, and was measured:
`starting:opacity-0` compiles into an `@starting-style` block and
`transition-discrete` into `transition-behavior: allow-discrete`. What the
sheets keep is therefore a deliberate choice of clarity, size or single
ownership in every case, never an "impossible". The guards hold both sides to
that: every generated colour must resolve to a declared role
(`__tests__/utility-colour-roles.test.ts`) and every class a sheet selects must
be carried by its own markup (`__tests__/customization-surface.test.ts`).

### What is NOT part of this contract

The declared surface is the two lists above: **`::part` names and the consumed
role variables.** Everything else a component class exposes on its type — its
internal class hooks, its computed signals, its methods — sits OUTSIDE those
lists, which is not the same as being ungoverned. Every one of them is a
published type shape: the package's retained-interface baseline (a checked-in
snapshot, verified by the repository's `interface:snapshot` task) fails on any
change until the
decision is made and the baseline is regenerated in the same change, and the
experimental disclaimer (owner ruling C1, #1468) is what lets such a decision be
"removed" rather than "kept forever". There is no blanket rule that exported
types may churn; there is a per-change decision, recorded and pinned. The two
cases below are exactly that — individual decisions, not precedents that make
the next one free:

- **Internal class hooks are not a contract.** A class a sheet selects
  (`open-button`'s `btn`, `open-input`'s `control`) is internal: an element in a
  shadow root can only be reached through its `::part`, so no consumer can
  address a hook directly. The hook-name guard
  (`__tests__/customization-surface.test.ts`) keeps the sheet and the markup
  spelling the same hook, which is what stops a rename from silently killing
  rules; it does not make the name public.
- **A retired class-carrying signal is not a compatibility break.** The alpha15
  S lane deleted `OpenInput.inputClass`, a computed whose only value was the
  internal class string (`'control input input--error'`) and whose only
  consumer was the `class=` binding that is now a static literal. It was never
  an attribute (it could not be set from markup) and never part of the lists
  above. It is retired rather than restored: re-adding a signal with no
  behavior would keep a type shape green while telling a consumer nothing true.
  The same change retired the `input--error` class: `:host(:state(invalid))`
  owns that border.

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
`--color-muted(-foreground)`, `--color-accent(-foreground)`,
`--color-destructive(-foreground)`, `--color-success`, `--color-warning`,
`--color-info`, `--color-border`, `--color-input`, `--color-ring`, and
`--color-chart-1` … `--color-chart-5`.

### Which engine compiles the components (alpha15 stage 2B)

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
- Code-block and dialog backdrop keep static zinc surfaces in both themes
  (the retired sheet's behavior, now explicit literals-free ramp references).

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
  authored as Tailwind utilities (alpha15 S lane). The sheet keeps the host
  box, the `[hidden]` rule, the size and variant surfaces (host-attribute
  scoped: the utility spelling exists — `[:host([size='sm'])_&]:p-1` compiles —
  and costs ≈6.5× the bytes for the same branches; see
  [Why the residue is CSS](#why-the-residue-is-css)), the derived base surface,
  and the form-associated disabled state. Variant `primary`/`accent` fill with
  `--color-primary` over `--color-primary-foreground`.

### `open-code-block`

- Parts: `copy`
- Variables: `--color-destructive`, `--color-success`
- The chip's presentation is authored as Tailwind utilities (alpha15 S lane);
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
  are authored as Tailwind utilities (alpha15 S lane). The sheet keeps the
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
  content's presentation is authored as Tailwind utilities)
- Shares the overlay recipe for the popover surface.

### `open-input`

- Parts: `wrapper`, `label`, `control`, `error`
- Variables: `--color-border`, `--color-destructive`, `--color-muted`,
  `--color-popover`, `--color-primary`, `--color-violet-400`, `--spacing`
- The wrapper layout, the label's typography, the control's box (width,
  padding, font, radius, transition, outline) and the error message's ink are
  authored as Tailwind utilities (alpha15 S lane). The sheet keeps the host
  box, the control's derived surfaces (the popover/border mixes, the violet
  hover border, the focus ring's box-shadow) and the disabled / invalid
  treatments scoped to the host's form state; those states use
  `--color-destructive`.

### `open-theme-toggle`

- Parts: `toggle`, `icon-sun`, `icon-moon`
- Variables: `--color-background`, `--color-border`, `--color-popover`,
  `--color-primary`, `--color-violet-400`, `--spacing`
- The button's element-level presentation (flex box, size, radius, cursor,
  ink, focus ring, transition) is authored as Tailwind utilities (alpha15 S
  lane); the sheet keeps the derived surface, its hover values and the
  `[data-theme]` icon display swap.

### Shared recipes (`component-recipes.ts`)

- `surface-recipe.css` (`.surface`): `--color-border`, `--color-card`,
  `--color-foreground`, `--color-popover`, `--color-primary`, `--color-white`,
  `--radius-lg`, `--shadow-2xl`, `--spacing`
- The control recipe retired with the alpha15 utility migration: open-button
  and open-input author their control surface as utilities plus each
  component's own irreducible residue (above), so there is one owner per
  property instead of a shared sheet plus overrides.
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
