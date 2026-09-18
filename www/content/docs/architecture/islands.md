---
title: 'Island Hydration'
lede: 'openElement keeps documents and Web Components server-rendered by default. Islands are reserved for client components that need runtime state or framework interop.'
navLabel: 'Islands'
order: 40
---

## Static surface

The server emits a complete document: page markup, style sheets scoped to their hosts, and each component's content inside a Declarative Shadow DOM template (`<template shadowrootmode="open">`) — or directly in the DOM when the component declares a light root. The browser parses all of it natively, so the page is readable, styled and crawlable before any framework module is fetched.

Every component is classified into one of four layers, and the layer decides what the server writes and what a client module later claims:

- `dsd-static` — serialized as DSD; no client module ever loads it.
- `dsd-interactive` — serialized as DSD; the compiled claim binds behavior on upgrade.
- `light-dom` — compiled light root; no shadow boundary, so document styles apply directly.
- `pure-island` — browser-only; the server writes the host tag and its serialized props, and the client owns rendering.

The same classification admits third-party elements (standard Custom Elements, Lit, FAST, Stencil) at build time with actionable diagnostics, rather than letting an unrenderable component through.

## Hydration boundary

The boundary is declared, not discovered. An island module opts in next to the component it exports with `defineIslandConfig({ hydrate, ssr, dsd })`, and the build records the outcome per page in an island manifest: one JSON artifact per page carrying the route and, for each island, its tag, chunk URL, layer and strategy. The generated client entry imports only the modules that page declares, so a page's client graph is a direct consequence of its own metadata.

Because the manifest is emitted next to the HTML, the built output answers "which JavaScript does this page load, and when?" without opening the client bundle.

## Progressive behavior

The claim replays the compiled Part Program against DOM that is already present: the handlers the template declared are bound, `@property` fields are filled from host attributes, and a `pure-island` renders for the first time. Untouched nodes are never re-rendered, no binding is discovered by string lookup, and no event is synthesized from a `data-*` attribute.

The strategy decides when the chunk is fetched — `load`, `idle`, `visible` or `only`. Until it arrives, the element keeps its server markup and its styling: the page never depends on an island having loaded, and an island that is never reached costs nothing beyond its own chunk.

## Upgrade Model

Islands are the only client JavaScript units in openElement. The public model is the compiled element class: server serialization, fresh DOM and existing-DOM claim share one Part Program.

openElement uses the browser Custom Element upgrade mechanism. SSG writes HTML first, then the generated client entry imports only the island modules used by the current page and registers their compiled classes.

## Four Layers

### Layer 1 — `dsd-static` — No client JavaScript

Static Web Components render as DSD during SSG. They remain visible and styled even when no client module runs.

### Layer 2 — `dsd-interactive` — DSD plus compiled claim

The server serializes the island's compiled Part Program as DSD. On upgrade, the generated claim artifact walks the same program against the existing DOM and binds the declared event handlers — no binding-discovery walk, no string method lookup, no `data-on-*` event attributes.

### Layer 3 — `pure-island` — Client-owned shadow root

Browser-only components can opt out of SSR with the `only` strategy. The server emits the host tag and its serialized props; the client owns rendering.

### Layer 4 — `light-dom` — No shadow boundary

A component that declares a light root renders its content into light DOM with no DSD encapsulation, so document-level styles apply directly. The compiled default stays shadow-open; light DOM is opt-in per component. Hydration strategies still apply to such islands.

## Strategies

- `load` — Import immediately for first-paint controls such as navigation and theme.
- `idle` — Import during idle time for non-critical interactive components.
- `visible` — Import when the island approaches the viewport.
- `only` — Skip SSR for browser-only components that cannot produce reliable DSD.

## Props Are Not Events

Host attributes and serialized props restore into the island's compiled `@property` fields on upgrade; the claim does not invent events from them. Events exist only where the compiled template declared a handler.

## Dynamic Content

Dynamic island content comes from signal-driven `@property` state inside the compiled template. HTML injection stays behind the explicit `trustedHtml` boundary for pre-sanitized, non-interactive content only.

## See also

- [DSD Rendering](/architecture/dsd) — the platform contract the static surface relies on.
- [Islands and SSR](/guide/islands-and-ssr) — declaring islands in an application.
