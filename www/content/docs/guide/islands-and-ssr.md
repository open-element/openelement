---
title: 'Islands and SSR'
lede: 'SSR and DSD provide the document baseline. Islands add client behavior at declared boundaries.'
order: 90
---

## Server first

Every route renders to HTML at build time by default. The output is ordinary declarative markup: content components are serialized as shadow roots the browser parses without script, style sheets are inlined (scoped with `@scope(<tag>)` for light roots), and the document is styled and readable before a single client module is fetched. A page whose markup is static therefore stays static even if the network is slow, the module fails to load or JavaScript is disabled.

A page that genuinely cannot be prerendered declares `renderIntent: { mode: 'dynamic' }` and renders per request through the generated `dist/server` entry. It is still the same compiled program — a loader supplies the data instead of the build — so moving a page between static and dynamic changes where it renders, not how the markup is produced. A page that keeps a static GET but exports an action stays prerendered and dispatches only its POSTs to the server.

## Declared islands

Client behavior is opt-in per module and visible in metadata, never inferred. An island declares its delivery next to the component it exports:

```tsx
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ hydrate: 'visible', ssr: true, dsd: true });
```

`hydrate` selects when the module is imported — `'load'` for first-paint controls, `'idle'` for work that can wait, `'visible'` for components that matter as they approach the viewport, and `'only'` for browser-only components that skip SSR. `ssr` and `dsd` state whether the server serializes the component at all. The build records the result per page, so an island that a page never reaches is never fetched.

The upgrade itself is the browser's Custom Element mechanism. The server serializes the compiled Part Program as Declarative Shadow DOM; when the class is defined the generated claim artifact runs the same program against the DOM that is already there, binding the handlers the template declared and restoring `@property` fields from host attributes. No tree is rebuilt, no binding is discovered by string lookup, and no event is synthesized from an attribute.

## Small runtime

What ships is the set of island chunks a page declares plus the generated claim code — there is no framework runtime that every page must load. A page with no interactive module loads no framework JavaScript at all, and a page whose islands are all `'visible'` pays nothing until the reader scrolls to them.

That budget is the reason the static surface matters. Anything that can be expressed as markup — content, layout, documentation, even fully styled interactive-looking components — should stay static DSD; islands are reserved for state and browser APIs. Component code is identical in both cases, so the decision is a one-line declaration rather than a rewrite, and it can be revisited when the component's real requirements become clear.

## See also

- [Island Deep Dive](/architecture/islands) — the four component layers and how claim works.
- [DSD Rendering](/architecture/dsd) — the platform contract behind the server output.
- [Island Hydration](/architecture/islands) — the same boundary described for the component model.
