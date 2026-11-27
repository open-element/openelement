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

- Static components for content, layout and documentation — plain HTML either way: the compiled default root is light DOM, and a component that declares a shadow root travels as DSD.
- Interactive elements for local browser behavior.
- Islands for client components that need framework runtimes.

## Platform standards

openElement relies on web-platform contracts rather than a proprietary registry product. Custom Elements, DSD, CEM, Request/Response and FormData define the direction of the public application model.

### Elements + DSD

Standard Custom Elements and Declarative Shadow DOM define the durable component boundary.

### Request semantics

`Request`, `Response` and `FormData` are the basis of the current loader/action surfaces — application interaction without a proprietary transport.

### Package ownership

`Element`, `Router`, `Create` and the experimental `UI` package are the consumer surface most authors touch. `Protocol` and `Compiler` are published too, for the tools and contract types built on them: `Protocol` carries the cross-package contracts and `Element` re-exports several of them, while `Compiler` is consumed directly by the build layer that uses it; internal implementation stays internal.

## See also

- [Core Concepts](/guide/core-concepts) — declaring a component's root mode.
- [Light DOM, DSD, SSR and islands](/guide/islands-and-ssr) — the four terms side by side, the current compiled default, and the request-to-interaction flow.
- [Current Architecture](/architecture) — where each package sits in the graph.
