---
title: 'Theme with tokens'
lede: 'Rebrand a site through :root custom properties — including a dark variant — without touching component styles.'
navLabel: 'Theming'
order: 121
section: 'Recipes'
---

## Tokens first

Pages read semantic roles (`--brand`, `--text-primary`, `--bg-base`); components never hardcode a palette. So a theme is a `:root` override sheet, not a fork of every component. This is the contract from [Styling](/guide/styling): custom properties inherit through shadow boundaries.

## The override sheet

```css
:root {
  --brand: #0f766e;
  --brand-hover: #115e59;
  --brand-subtle: rgb(15 118 110 / 0.12);
}

:root[data-theme='dark'] {
  --brand: #2dd4bf;
  --brand-hover: #5eead4;
  --bg-base: #0b0f0e;
  --text-primary: #e7efed;
}
```

Adopt it as a document-level stylesheet (or inline it in the app shell head). Every shadow tree inherits the new ink on next paint — no component rebuild.

## The checklist

- Override **roles**, never raw scales: `--brand` and `--bg-*`/`--text-*`, not `--violet-7`. Raw scales are tuned per theme; roles already encode the pairing.
- Ship both themes together. A light-only override leaves dark mode wearing half a brand.
- Keep the AA pairing: body text needs 4.5:1 against its surface in both themes. Check the two surfaces your theme touches most (page base, cards) and stop there.
- Status colors (`--success`, `--warning`, `--error`, `--info`) are semantic too — re-tint them only if the brand demands it, and keep their subtle washes translucent.

## See also

- [Styling](/guide/styling) — where page styles live and what crosses a shadow boundary.
- [Design System](/architecture/design-system) — the token roles this recipe overrides.
- [Glossary](/guide/glossary) — Custom Element, shadow root, DSD in one place.
