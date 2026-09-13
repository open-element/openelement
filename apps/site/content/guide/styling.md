---
title: 'Styling'
lede: 'Every page renders inside a custom element with declarative shadow DOM — a global stylesheet alone will not reach it.'
order: 5
---

## The shadow boundary

Route pages render inside per-page custom elements (for example `<page-blog-post>`), and the server sends their content inside declarative shadow DOM. The page's own `<style>` and `StyleSheet` rules live in the shadow root. A document-level rule like `.card { ... }` or `h1 { ... }` is scoped to the light DOM and never reaches page content — silently: no console warning, no build error.

## What crosses the boundary

CSS custom properties inherit through shadow boundaries: `--text-primary`, `--brand` and friends defined on `:root` are readable inside every page. `:host` styles the page element itself from inside; `::slotted()` styles light-DOM children projected into slots. Inherited text properties (`color`, `font-family`, `line-height`) also pass through.

## What does not

Class, id, and tag selectors from a document stylesheet never match inside the shadow root. Global resets (`margin: 0` on `*`), typography rules, and utility-class systems therefore apply only to the document shell. This is encapsulation by design — it is also the most common first-day trap, because the instinct is a global stylesheet.

## The two supported patterns

One: a scoped `StyleSheet` — `const s = new StyleSheet(); s.replaceSync(...);` and assign it as the component's `static styles` so it lands in the shadow root (adoptedStyleSheets on shadow roots, a document-head sink on light roots). Two: CSS custom properties defined on `:root`, which inherit through the shadow boundary. Document-level `<link rel="stylesheet">` and `<style>` in the head do not apply to shadow content, and raw-text `<style>` tags are rejected from compiled templates.

### A document-level stylesheet (does not apply)

```css
/* app/styles.css — linked in the document head */
.card { border: 1px solid silver; }  /* never matches page content */
```

### A scoped StyleSheet (applies)

```tsx
// app/components/page-example.styles.ts — sheets live outside compiled modules
import { StyleSheet } from '@openelement/element';

const styles = new StyleSheet();
styles.replaceSync(`
  :host { display: block; }
  .card {
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 1rem;
    color: var(--text-primary);
  }
`);

export default styles;
```

```tsx
// app/components/page-example.tsx — compiled by the open:compiled-element transform
import { element, OpenElement } from '@openelement/element';
import styles from './page-example.styles.ts';

@element('page-example', { root: 'shadow-open' })
export default class ExamplePage extends OpenElement {
  static override styles = styles;

  render() {
    return <section class='card'>Themed through custom properties.</section>;
  }
}
```

## Custom properties in practice

The starter defines a design-token layer on `:root` (colors, fonts, spacing) precisely so pages can be themed entirely through custom properties. Theme with tokens first; use the component `StyleSheet` for the page-internal layout and typography.
