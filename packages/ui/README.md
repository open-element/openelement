# @openelement/ui

> Experimental product: maintained in the OpenElement repository, outside the
> 1.0 stable API promise. APIs may change without a migration path during Alpha.

First-party dogfood and reference UI package for OpenElement.

Element and Router are the two core products; Router includes Framework Mode.
UI demonstrates and tests those products rather than defining a third core product
or a comprehensive design-system roadmap. The existing package remains available;
this positioning does not remove components or force migration to another library.

The components are first-party `open-*` Web Components. They are designed to
prove the OpenElement authoring model with shadow/DSD output, explicit light DOM
where needed, and island upgrade. UI is a supporting reference surface, not a
separate application-framework promise.

As of v0.42.0-alpha.10, there is **no Linear compatibility layer**. The legacy
`open-*-linear` components and `linear-token-sheet` token sheet have been
removed from the public surface. Use the canonical Open Props components and
`@openelement/ui/open-props-tokens` instead.

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
audited Open Props subset
  -> semantic tokens
    -> component recipes
      -> Web Component primitives
```

Tokens contain shared style values and classes and import no components.
Primitives may consume tokens but never composites. Composites may compose
primitives and tokens. Application routing and document navigation belongs to
`@openelement/router`; the site layout component (`OpenLayout`) lives in the
reference site (`www/app/islands/open-layout.tsx`).

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

The reference site wires the same scripts through the `inject` option in
`www/vite.config.ts`.

## Design tokens

`src/open-props-tokens.css` and its CSSOM mirror `src/open-props-tokens.ts`
are **generated — do not edit**. Regenerate with:

```bash
deno task --cwd tools/repo ui:tokens
```

Sources:

- Upstream [open-props](https://open-props.style) `1.7.23` (**MIT**,
  © Adam Argyle) — only the tokens we carry verbatim: the gray ramp,
  `--indigo-6`, two border sizes, font weights, and two line-heights, read
  from the package's per-topic `src/props.*.js` files. The generator fails if
  upstream renames one of them, so drift surfaces at generation time.
- `src/semantic-tokens.css` (**ours**, hand-maintained) — everything else:
  re-tuned scales (violet/green/red/orange, px spacing, radii, type sizes,
  easings, shadows), semantic roles, both themes, the `:host` fallback, and
  the CJK font stacks. Each divergence from upstream is commented where it
  lives; do not "fix" tuned values by copying upstream.

`openPropsTokenSheet` (`:host` form, adopt into a shadow root) and
`openPropsRootSheet` (`:root` form, document-level adoption — the `:host`
→ `:root` transform lives in the generated module) are the only token
entry points. The token gates require `--surface-glass`,
`--ui-control-bg`, `--focus-ring` and `--motion-standard`.
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
@openelement/ui/open-props-tokens
```

## License

MIT
