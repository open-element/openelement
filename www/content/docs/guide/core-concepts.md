---
title: 'Core Concepts'
lede: 'The core model is standards-first: authored elements, declarative rendering, file routes and optional islands.'
order: 10
---

## OpenElement

`OpenElement` from `@openelement/element` extends `HTMLElement` and is the base class of every component in an application. Components are authored in TSX and lowered at build time into a Part Program — a versioned, serializable artifact that the runtime replays. No virtual-DOM runtime and no interpreter ship to the browser: unsupported authoring fails with a compiler diagnostic instead of falling back to a runtime render path.

Two compile-time decorators carry a component's contract:

```tsx
import { computed, element, OpenElement, property, type ReadonlySignal } from '@openelement/element';

@element('my-counter', { root: 'shadow-open' })
export default class MyCounter extends OpenElement {
  @property({ reflect: true })
  count = 0;

  @property({ reflect: false })
  label = '';

  @property({ reflect: false, attribute: false, type: Boolean })
  empty: ReadonlySignal<boolean> = computed(() => this.count === 0);

  render() {
    return (
      <div class='counter'>
        <p>{this.label}</p>
        <button type='button' disabled={this.empty}>-</button>
        <span id='count'>{this.count}</span>
        <button type='button'>+</button>
      </div>
    );
  }
}
```

`@element(tag, { root })` names the custom element and where its content renders: `'light'` is the default and renders into light DOM so document-level styles apply directly, while `'shadow-open'` and `'shadow-closed'` attach a shadow root. `@property({ reflect })` declares a reactive field. The attribute is the default channel, named after the kebab-cased property (`attribute: 'my-name'` overrides it); `attribute: false` opts out for values that must never be serialized into markup. A derived value is a `computed(...)` field, which the compiler requires to be `reflect: false, attribute: false` because it has no attribute channel. `signal()` sits behind both — `computed()` derives from it and `effect()` subscribes to it; all three are exported from `@openelement/element`.

A state change re-renders only the Parts that read the changed value. Event handlers written in the template (`onClick`, `onInput`) are bound at upgrade; nothing is looked up by string at runtime. Server-side, the same compiled class is serialized to markup by `renderDsd`, so there is one program behind both outputs rather than two renderers that can drift.

## DSD

Server output is Declarative Shadow DOM: component markup travels inside `<template shadowrootmode="open">` and the browser parses it natively, without script. The document is styled and readable on first paint — before any client module is fetched. Styles declared in a component's `static styles` are inlined; for a light root the server scopes them in a `@scope(<tag>)` block so page rules cannot leak into the rest of the document.

Interactivity arrives through the platform's own Custom Element upgrade: when the generated client entry defines the class, it claims the DOM that is already there, binds the handlers the compiled template declared, and fills `@property` fields from host attributes. Host attributes restore fields — they never invent events. An element whose class never loads still renders its markup, which is why a JS failure degrades to a static page instead of an empty one.

## Islands

An island is a module under the islands directory (`app/islands` by default) that opts into client delivery. It declares how it is delivered next to the component it exports:

```tsx
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ hydrate: 'idle', ssr: true, dsd: true });
```

`hydrate` selects when the browser imports the module — `'load'` for controls needed at first paint such as navigation and theme, `'idle'` for everything else that can wait, `'visible'` for components that only matter as they scroll into view, and `'only'` for browser-only components that skip SSR. The build records which islands belong to which page, so a page references only the chunks it can use and an island that is never reached is never fetched.

Everything else — content, layout, documentation — needs no client behavior and stays static DSD, shipping no JavaScript at all. That split is the whole runtime story: browser code exists only where a module declared it.

## See also

- [Routing and Data](/guide/routing-and-data) — pages, loaders and actions on top of these elements.
- [Getting Started](/guide/getting-started) — the three commands that create a project.
- [DSD Rendering](/architecture/dsd) — how Declarative Shadow DOM carries the server output.
