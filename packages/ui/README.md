# @openelement/ui

> Experimental product: maintained in the OpenElement repository, outside the
> 1.0 stable API promise. APIs may change without a migration path during Alpha.

Docs and guides: <https://openelement.org>.

First-party dogfood and reference UI package for OpenElement.

Element and Router are the two core products; Router includes Framework Mode.
UI demonstrates and tests those products rather than defining a third core product
or a comprehensive design-system roadmap. The existing package remains available;
this positioning does not remove components or force migration to another library.

The components are first-party `open-*` Web Components. They are designed to
prove the OpenElement authoring model with shadow/DSD output, explicit light DOM
where needed, and island upgrade. UI is a supporting reference surface, not a
separate application-framework promise.

There is **no Linear compatibility layer**: the `open-*-linear` components and
the `linear-token-sheet` token sheet are not part of the public surface. Use the
canonical components and `@openelement/ui/theme-tokens` instead.

## Install

```bash
npm install @openelement/ui
```

## Components

| Component         | Tag                 | Notes                                                            |
| ----------------- | ------------------- | ---------------------------------------------------------------- |
| `OpenButton`      | `open-button`       | Button component.                                                |
| `OpenInput`       | `open-input`        | Input component.                                                 |
| `OpenCard`        | `open-card`         | Content card.                                                    |
| `OpenCodeBlock`   | `open-code-block`   | Code block with copy behavior; Prism highlighting (host-loaded). |
| `OpenBadge`       | `open-badge`        | Status/content badge.                                            |
| `OpenThemeToggle` | `open-theme-toggle` | Theme switch island.                                             |
| `OpenDialog`      | `open-dialog`       | Modal/non-modal dialog.                                          |
| `OpenCallout`     | `open-callout`      | Callout/notice box.                                              |
| `OpenDropdown`    | `open-dropdown`     | Popover-first dropdown.                                          |
| `OpenTabs`        | `open-tabs`         | Accessible tab interface.                                        |

## Layering contract

Dependencies flow in one direction:

```text
@theme-derived token table (theme.css)
  -> semantic alias layer (semantic-tokens.css)
    -> component recipes
      -> Web Component primitives
```

Tokens contain shared style values and classes and import no components.
Primitives may consume tokens but never composites. Composites may compose
primitives and tokens. Application routing and document navigation belongs to
`@openelement/router`; the site layout component (`OpenLayout`) lives in the
reference site that consumes this package, not in it.

## `open-code-block` syntax highlighting

`open-code-block` ships the copy button and Prism token styles, but bundles
**no tokenizer and no highlighting runtime** — the component itself stays
cross-runtime, so the host page must load Prism (core plus each language
grammar) as a global script. (The package as a whole depends on
`@openelement/element`; this note is scoped to the code block.)
On hydration the component looks for `globalThis.Prism`, tokenizes the
slotted `<pre><code class="language-x">`, and swaps in the highlighted copy
inside the shadow root. Without Prism it renders plain text with the copy
button (and retries briefly while deferred scripts load).

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/prism.min.js"></script>
<script
  src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-typescript.min.js"></script>

<open-code-block>
  <pre><code class="language-typescript">const x: number = 1;</code></pre>
</open-code-block>
```

The reference site wires the same scripts through its Vite `inject` option.

## Design tokens

The token layer is hand-maintained — there is no generator. Two authored CSS
sources, one carrier:

- `src/theme.css` — **the single source of design roles** (P6: the only place
  in the repository that defines them). shadcn-convention roles
  (`--color-background`, `--color-primary`, …) seated on the Tailwind v4
  default scale; the scale layer carries zero authored values (every value is
  the verbatim Tailwind v4.1.16 default), roles reference only scale
  variables, dark pairs follow the shadcn v4 convention with the selector
  re-pointed at this repo's `[data-theme='dark']` mechanism, and a
  forced-colors layer re-seats every role on a system color. When Tailwind is
  installed (roadmap C2), this file's scale layer becomes the real `@theme`
  block; role names are the migration contract.
- `src/semantic-tokens.css` — the alias layer: retired token names
  (`--brand`, `--size-*`, `--violet-*`, …) mapped onto the roles so the
  component recipes keep rendering. It defines no roles and no color values.
  It is deleted with no replacement once C3 renames the recipes onto the role
  names.
- `src/theme-tokens.ts` — the carrier: inlines both sources verbatim and
  exports `themeTokenCss` (the deployable sheet text) plus `themeTokenSheet`
  (a constructable sheet built from it). The token blocks select
  `:root, :host`, so the same sheet serves document-level adoption and
  shadow-root adoption (only the structural fallback is `:host`-only).

`themeTokenSheet` is the only token entry point. The ui suite fails closed on
carrier/source divergence, on token-contract regressions (`--surface-glass`,
`--ui-control-bg`, `--focus-ring`, `--motion-standard`), and on WCAG floors
(3:1 focus ring, 4.5:1 state inks on their background and their badge wash).
`daisyClassSheet`, modal and step-card are retired and must not reappear in
exports, manifests, docs or packed artifacts.

Existing per-component imports remain stable across this layering change.

## Package Manifest

`@openelement/ui` exports a generated `manifest` of component declarations
(attributes, events, slots, CSS parts, plus openElement SSR/DSD/hydration
metadata) so openElement can include these components in package manifest
scanning:

```ts
import { openElement } from '@openelement/router/vite';

export default {
  plugins: [
    openElement({
      packageIslands: ['@openelement/ui'],
    }),
  ],
};
```

The manifest includes attributes, events, slots, CSS parts, SSR renderability,
DSD behavior, and hydration strategy metadata.

Manifest `attributes` cover only each component's `observedAttributes` set —
that is all the generator scans. Attributes a component reads without
observing (e.g. `open-dialog`'s `label` and `mode`, read at render/open time
so no change listener is needed) are fully supported but absent from the
manifest; the per-component JSDoc is the source of truth for those.

## Subpath Exports

```text
@openelement/ui/open-button
@openelement/ui/open-input
@openelement/ui/open-card
@openelement/ui/open-code-block
@openelement/ui/open-badge
@openelement/ui/open-theme-toggle
@openelement/ui/open-dialog
@openelement/ui/open-callout
@openelement/ui/open-dropdown
@openelement/ui/open-tabs
@openelement/ui/theme-tokens           (token sheet text + constructable sheet; node-safe leaf)
@openelement/ui/instance-state         (per-element instance state store; tree-shakeable leaf)
@openelement/ui/manifest               (generated WC package manifest; node-safe leaf)
```

## License

MIT
