---
title: 'Declarative Shadow DOM Rendering'
lede: 'openElement treats Declarative Shadow DOM as the server-rendered boundary for Web Components, then upgrades only the behavior that must run in the browser.'
navLabel: 'DSD Rendering'
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

## Platform standards

OpenElement relies on web-platform contracts rather than a proprietary registry product. Custom Elements, DSD, CEM, Request/Response and FormData define the direction of the public application model.

### Elements + DSD

Standard Custom Elements and Declarative Shadow DOM define the durable component boundary.

### Request semantics

`Request`, `Response` and `FormData` are the basis of the current loader/action surfaces — application interaction without a proprietary transport.

### Four-package ownership

`Element`, `Router`, `Create` and the experimental `UI` package are the current consumer surface; internal contracts stay internal.

## See also

- [Island Hydration](/architecture/islands) — when a component crosses into client delivery.
- [Island Deep Dive](/architecture/islands) — the layers and hydration strategies.
- [Core Concepts](/guide/core-concepts) — declaring a component's root mode.
- [Current Architecture](/architecture) — where each package sits in the graph.
