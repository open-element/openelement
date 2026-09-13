---
title: 'Island Deep Dive'
lede: 'Islands are the only client JavaScript units in openElement. The public model is the compiled element class: server serialization, fresh DOM and existing-DOM claim share one Part Program.'
order: 50
---

## Upgrade Model

openElement uses the browser Custom Element upgrade mechanism. SSG writes HTML first, then the generated client entry imports only the island modules used by the current page and registers their compiled classes.

## Three Layers

### Layer 1 — `dsd-static` — No client JavaScript

Static Web Components render as DSD during SSG. They remain visible and styled even when no client module runs.

### Layer 2 — `dsd-interactive` — DSD plus compiled claim

The server serializes the island's compiled Part Program as DSD. On upgrade, the generated claim artifact walks the same program against the existing DOM and binds the declared event handlers — no binding-discovery walk, no string method lookup, no `data-on-*` event attributes.

### Layer 3 — `pure-island` — Client-owned shadow root

Browser-only components can opt out of SSR with the `only` strategy. The server emits the host tag and its serialized props; the client owns rendering.

## Strategies

- `load` — Import immediately for first-paint controls such as navigation and theme.
- `idle` — Import during idle time for non-critical interactive components.
- `visible` — Import when the island approaches the viewport.
- `only` — Skip SSR for browser-only components that cannot produce reliable DSD.

## Props Are Not Events

Host attributes and serialized props restore into the island's compiled `@property` fields on upgrade; the claim does not invent events from them. Events exist only where the compiled template declared a handler.

## Dynamic Content

Dynamic island content comes from signal-driven `@property` state inside the compiled template. HTML injection stays behind the explicit `trustedHtml` boundary for pre-sanitized, non-interactive content only.
