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
canonical components and the `@theme` role table in
[`src/theme.css`](./src/theme.css) instead.

## Install

```bash
npm install @openelement/ui
```

## Components

| Component         | Tag                 | Notes                                                            |
| ----------------- | ------------------- | ---------------------------------------------------------------- |
| `OpenButton`      | `open-button`       | Button component.                                                |
| `OpenInput`       | `open-input`        | Input component.                                                 |
| `OpenCodeBlock`   | `open-code-block`   | Code block with copy behavior; highlighting is the host's build-time step (authored function component; the element class is build-emitted, not exported). |
| `OpenThemeToggle` | `open-theme-toggle` | Theme switch island (authored function component; the element class is build-emitted, not exported). |
| `OpenDialog`      | `open-dialog`       | Modal/non-modal dialog.                                          |
| `OpenDropdown`    | `open-dropdown`     | Popover-first dropdown.                                          |

## Layering contract

Dependencies flow in one direction:

```text
@theme-derived token table (theme.css)
  -> component recipes (role names, direct)
    -> Web Component primitives
```

Tokens contain shared style values and classes and import no components.
Primitives may consume tokens but never composites. Composites may compose
primitives and tokens. Application routing and document navigation belongs to
`@openelement/router`; the site layout component (`OpenLayout`) lives in the
reference site that consumes this package, not in it.

## `open-code-block` and syntax highlighting

`open-code-block` ships the copy button only. It bundles **no tokenizer and no
highlighting runtime** — the component stays cross-runtime, and since the
runtime-highlighter contract was retired (#1552) it no longer looks for a
global `Prism` either. The host page compiles its code fences to token-span
HTML at BUILD time (the reference site runs Shiki inside its markdown
pipeline) and projects the result through the slot; the projected content
stays light DOM, so the host's stylesheet owns the code surface and the token
inks, and the component only paints its chip.

```html
<!-- build time: markdown fences -> <pre class="shiki …"><code>…token spans…</code></pre> -->
<open-code-block>
  <pre><code>const x: number = 1;</code></pre>
</open-code-block>
```

Without a host-side highlighting step the block renders plain text with the
copy button — an expected degradation, not a bug.

## Design tokens

The token layer is hand-maintained — there is no generator. One authored CSS
source, no shipped values:

- `src/theme.css` defines the semantic `--color-*` roles over the Tailwind
  scale, including dark pairs and system colors for forced-colors mode.
- The Router Tailwind entry compiles the role table and its scale. Applications
  with manual CSS delivery supply those variables through their own stylesheet.

Use [the customization surface](./CUSTOMIZATION.md) for each component's
published `::part()` selectors and consumed variables. The UI test suite
checks those declarations, role coverage, and focus and status contrast.

## Package Manifest

`@openelement/ui` exports a generated `manifest` of component declarations
(attributes, events, slots, CSS parts, plus openElement SSR/DSD/hydration
metadata) so openElement can include these components in package manifest
scanning:

```ts
import { openElement } from '@openelement/router/vite';

export default {
  plugins: [openElement()],
};
```

Admission is automatic (`packageIslands` defaults to `'auto'`): the build
derives the set from the app's real imports, so an ordinary
`import '@openelement/ui/open-button'` delivers the component once the
manifest above is visible to the build. The explicit list stays available for
pinning (`packageIslands: ['@openelement/ui']`) and `'manual'` turns the
derivation off.

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
@openelement/ui/open-code-block
@openelement/ui/open-theme-toggle
@openelement/ui/open-dialog
@openelement/ui/open-dropdown
@openelement/ui/theme.css              (the @theme role source; compiled through the router Tailwind entry)
@openelement/ui/instance-state         (per-element instance state store; tree-shakeable leaf)
@openelement/ui/manifest               (generated WC package manifest; node-safe leaf)
```

## License

MIT
