---
title: 'Design System'
lede: 'The active site dogfood contract: @theme semantic role tokens, retained UI primitives, product-art diagrams and full dark-mode parity. It is not a framework requirement.'
order: 15
section: 'Reference'
---

- Strict @theme semantic role tokens only.
- Only reusable primitives live in `@openelement/ui`; site visuals stay in `www`.
- Kinetic motion respects reduced-motion preferences.
- No Linear clone, decorative blobs, or local color systems.
- Letter spacing remains `0`.

## Semantic roles mapped to @theme tokens

Raw values stop at the @theme role boundary (packages/ui/src/theme-tokens.css); pages and primitives consume semantic roles.

| Role     | Tokens                                                                                                      | Purpose                                            |
| -------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Canvas   | `--color-background`                                                                                        | Page background and grid field.                    |
| Surface  | `--color-card` / `--color-popover`                                                                          | Reading surfaces and raised panels.                |
| Artifact | `--color-muted` / `--color-border`                                                                          | Code, devtools, route, and package diagrams.       |
| Text     | `--color-foreground` / `--color-muted-foreground`                                                           | Readable hierarchy in both themes.                 |
| Action   | `--color-primary` / `--color-primary-foreground`                                                            | Primary command and link emphasis.                 |
| State    | `--color-success` / `--color-warning` / `--color-info` / `--color-destructive`                              | Roadmap, standards, reference, and failure states. |

## The site dogfoods optional UI primitives

Button, input, badge and card behavior stays reusable; brand and cinematic objects remain private to the website.

### Ownership chain

- **Token** — surface, text, brand, focus, motion and elevation roles.
- **Recipe** — interactive state, typography and material composition.
- **Primitive** — ten reusable Web Components with tested semantics.

### Buttons

Commands use stable dimensions, token colors, and focus-visible states.

```html
<open-button variant="primary">Primary</open-button>
<open-button>Secondary</open-button>
<open-button variant="ghost">Ghost</open-button>
```

### Fields

Inputs stay utilitarian and inherit the same @theme token system.

```html
<open-input value="app/routes/index.tsx" readonly></open-input>
```

### Status + motion

Status labels and motion states are readable text first and color second.

```html
<open-badge tone="brand">current</open-badge>
<open-badge tone="success">done</open-badge>
<open-badge tone="warning">planned</open-badge>
```

## Code and diagrams are the visual asset

Real standards objects carry the visual identity without stock illustration or framework-shaped decoration.

## Composition principles

Each page begins with a product object, preserves dark/light parity and keeps motion subordinate to comprehension.

1. **Lead with the product object.** Show routes, package graphs, code, browser contracts, or docs structure in the first viewport.
2. **Use components as the site system.** The website dogfoods retained `@openelement/ui` primitives; UI remains optional for application authors.
3. **Treat dark mode as parity.** Every page and shadow component must resolve through the same semantic tokens.

## See also

- [Styling](/guide/styling) — how an application consumes these tokens.
- [DSD Rendering](/architecture/dsd) — the boundary the site's components are built on.
- [Measured output](/architecture/comparison) — the measured cost of the site that dogfoods them.
