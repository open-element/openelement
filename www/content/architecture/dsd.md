---
title: 'Declarative Shadow DOM Rendering'
lede: 'openElement treats Declarative Shadow DOM as the server-rendered boundary for Web Components, then upgrades only the behavior that must run in the browser.'
order: 30
---

## The platform contract

Declarative Shadow DOM uses a template with `shadowrootmode` so HTML can carry shadow-root content before client JavaScript loads.

```html
<my-card>
  <template shadowrootmode="open">
    <style>
    :host {
      display: block;
    }
    </style>
    <p>Visible before client JavaScript.</p>
  </template>
</my-card>
```

## Traditional hydration

A client runtime often reconstructs the component tree before the page is fully interactive.

## DSD-first rendering

The browser parses shadow roots from HTML. Custom Elements then upgrade existing hosts and attach only the needed behavior.

## openElement layers

- Static DSD components for content, layout, and documentation.
- Interactive elements for local browser behavior.
- Islands for client components that need framework runtimes.
