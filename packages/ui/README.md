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
canonical `open-*` components and `@openelement/ui/theme-tokens` instead.

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
@theme token source (src/theme-tokens.css)
  -> compiled role sheet (src/theme-tokens.ts)
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

`src/theme-tokens.css` is the single hand-maintained `@theme` source (alpha9
C1): the shadcn semantic role sheet adopted whole, plus three first-party
state roles and the Tailwind-default layout primitives the component tier
resolves at runtime. `src/theme-tokens.ts` is **generated — do not edit**;
regenerate from the package directory with:

```bash
pnpm run generate:theme-tokens
```

The drift gate for the same task runs as `theme-tokens:check` (wired into
`gate:source`). The Tailwind CLI is a pinned build-time devDependency; nothing
it emits on its own ships — the sheet carries exactly what this file authors.

`themeTokenSheet` is the only token entry point: the role block compiles to
`@layer theme { :root, :host }`, so the same sheet serves document-level
adoption and shadow-root adoption; the dark union carries
`html[data-theme="dark"]`, `.dark` and `:host([data-theme="dark"])`, and a
forced-colors tier mirrors the union.
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
@openelement/ui/theme-tokens
@openelement/ui/theme-tokens.js   (legacy alias of the previous entry)
@openelement/ui/instance-state         (per-element instance state store; tree-shakeable leaf)
@openelement/ui/manifest               (generated WC package manifest; node-safe leaf)
```

The `theme-tokens` entry is the compiled @theme role sheet (pure `.ts`,
node-safe). The `.js` form is a compatibility alias kept for import maps
written against the `.js` shape.

## License

MIT
