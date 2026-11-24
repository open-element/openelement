---
title: 'Styling'
lede: 'A shadow root renders as declarative shadow DOM, out of a global stylesheet’s reach. A light root has no boundary, so the build scopes its sheet.'
order: 5
---

## The shadow boundary

A page whose markup is its own component module renders inside a per-page custom element (for example `<blog-post-page>`), and that **page root is always a shadow root**: the compiler emits the DSD host template, the sidecar declares `root: 'shadow'`, and the server sends the page's content inside `<template shadowrootmode="open">`. The page's own `.css` sheet is declared inside that same template as a `<link>`, so its rules live in the shadow root and nowhere else.

A document-level rule like `.card { ... }` or `h1 { ... }` is scoped to the light DOM and never reaches shadow page content — silently: no console warning, no build error. That is the boundary working, not a bug to work around.

A page that genuinely needs document styles does not fight the boundary — it drops it, by taking the server-function form: the route module declares its own component and wraps it in `definePage`, and that markup *is* document content with no shadow root to cross. The build delivers that page module's declared sheet unscoped, because a page owns no host element and a `@scope` around a tag that never appears would match nothing.

For a nested component under `app/components/` or `app/islands/`, the root is a real choice: the sidecar declares `root: 'shadow'`, `'closed'`, or `'light'`, and omitting it means light.

## What crosses the boundary

CSS custom properties inherit through shadow boundaries: `--text-primary`, `--brand` and friends defined on `:root` are readable inside every page. `:host` styles the page element itself from inside; `::slotted()` styles light-DOM children projected into slots. Inherited text properties (`color`, `font-family`, `line-height`) also pass through.

A **light** root has no boundary, so the build gives it the closest honest equivalent: the emitted asset is wrapped in native `@scope (<tag>)` and the shadow-only selectors are projected onto the light tree — `:host` becomes `:scope`, `:host(<sel>)` becomes `:scope:is(<sel>)`, and `::slotted(<sel>)` becomes `slot > :is(<sel>)`. The same authored selector vocabulary therefore still means something, bounded by the component's own tag.

## What does not

Class, id, and tag selectors from a document stylesheet never match inside the shadow root. Global resets (`margin: 0` on `*`), typography rules, and utility-class systems therefore apply only to the document shell. This is encapsulation by design — it is also the most common first-day trap, because the instinct is a global stylesheet.

## The supported styling paths

One: authored `.css` files, declared once in the component's sidecar as `styles: ['./name.css']` — relative specifiers resolved against the module, one declaration and one delivery per root shape. The sheet is emitted as a content-addressed asset, never as CSS text inside the JavaScript chunk. How it reaches the component depends on the shape, and each shape has exactly one delivery:

- A **server-rendered shadow** component declares the asset with a parser-visible `<link rel="stylesheet" data-oe-static-styles>` inside its DSD template. That link *is* the delivery: the shell deliberately does not also adopt a constructable copy, because two deliveries of one resource would apply the same rules twice.
- A **light-root** component's sheet is delivered to the document, wrapped in its tag's `@scope` (see above).
- A **light page module** — the route module's own declaration, the server-function form — is delivered to the document **unscoped**, because a page owns no host element.
- A **client-only island** (`ssr: false` or `hydrate: 'only'`) has no template and no server render at all, so the compiler emits a real module-graph import of the same specifier and the generated shell adopts the resulting sheet object into the root it creates, releasing it on disconnect. Still one declaration, not a second channel.

Only a package sheet outside the project root that no client graph could emit falls back to an inlined memory `StyleSheet` for that render, and the build reports that fallback as a warning naming the fix (give the owning package a client entry). Two: utility classes from the configured CSS provider (the Tailwind preset by default; UnoCSS through the style-provider port) — the compiler admits static class tokens and the build emits them into the document stylesheet for light roots and into the shared component stylesheet for shadow components, so presentation lives in the markup and no CSS text ships inside JavaScript. Three: CSS custom properties defined on `:root`, which inherit through the shadow boundary. Document-level `<link rel="stylesheet">` and `<style>` in the head do not apply to shadow content, and raw-text `<style>` tags are rejected from compiled templates.

### A document-level stylesheet (does not apply)

```css
/* app/styles.css — linked in the document head */
.card { border: 1px solid silver; }  /* never matches shadow content */
```

### A component `.css` file (applies)

```css
/* app/components/example-page.css — the sheet is a file, not a JS string */
:host { display: block; }
.card {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 1rem;
  color: var(--text-primary);
}
```

```tsx
// app/components/example-page.tsx — compiled by the open:compiled-element transform
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'example-page',
  // The boundary is the whole point of this sheet: a document-level `.card`
  // rule cannot reach in, and this file's `.card` rule cannot leak out.
  root: 'shadow',
  // A specifier resolved against THIS module: the build emits it as a
  // content-addressed asset and declares it inside the DSD template, so no CSS
  // text is ever embedded in the component's JavaScript chunk.
  styles: ['./example-page.css'],
});

export default function ExamplePage() {
  return <section class='card'>Themed through custom properties.</section>;
}
```

Inline sheet strings are retired, and so is the class lane's `static styles`. `styles` accepts relative `.css` specifiers only: a bare package specifier, a URL or absolute path, or a non-`.css` entry fails with `OE_ISLAND_DESCRIPTOR_SHAPE`, a server-rendered shadow component with no compiled DSD host producer to declare the sheet in fails with `OE_ISLAND_STYLE_SHADOW_UNWIRED`, and a module the generated lane does not compile fails with `OE_ISLAND_STYLE_LANE_UNSUPPORTED` rather than being silently left unstyled.

## Custom properties in practice

The starter defines a design-token layer on `:root` (colors, fonts, spacing) precisely so pages can be themed entirely through custom properties. Theme with tokens first; use the component's `.css` sheet for the page-internal layout and typography.

## See also

- [Design System](/architecture/design-system) — how those tokens and semantic roles are organized.
- [Core Concepts](/guide/core-concepts) — the root modes and the sidecar's `properties` table referenced here.
- [Islands and SSR](/guide/islands-and-ssr) — when a component needs a shadow root at all.
