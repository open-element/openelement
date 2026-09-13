---
title: 'Design System'
lede: 'The active www dogfood contract: audited Open Props tokens, retained UI primitives, product-art diagrams and full dark-mode parity. It is not a framework requirement.'
order: 15
---

- Strict Open Props and semantic tokens only.
- Only reusable primitives live in `@openelement/ui`; site visuals stay in `www`.
- Kinetic motion respects reduced-motion preferences.
- No Linear clone, decorative blobs, or local color systems.
- Letter spacing remains `0`.

## Semantic roles mapped to Open Props

Raw Open Props values stop at the audited token boundary; pages and primitives consume semantic roles.

| Role     | Tokens                                           | Purpose                                            |
| -------- | ------------------------------------------------ | -------------------------------------------------- |
| Canvas   | `--bg-base`                                      | Page background and grid field.                    |
| Surface  | `--bg-card` / `--bg-elevated`                    | Reading surfaces and raised panels.                |
| Artifact | `--bg-code` / `--code-border`                    | Code, devtools, route, and package diagrams.       |
| Text     | `--text-primary` / `--text-secondary`            | Readable hierarchy in both themes.                 |
| Action   | `--brand` / `--on-brand`                         | Primary command and link emphasis.                 |
| State    | `--success` / `--warning` / `--info` / `--error` | Roadmap, standards, reference, and failure states. |

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

Inputs stay utilitarian and inherit the same Open Props token system.

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
