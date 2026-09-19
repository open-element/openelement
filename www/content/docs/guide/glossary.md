---
title: 'Glossary'
lede: 'The words the docs use, defined once. Each term names a real construct in the framework — not a marketing synonym.'
navLabel: 'Glossary'
order: 65
section: 'Core'
---

## Components

### Custom Element

The browser's component contract: a class registered for a hyphenated tag name. In openElement it is also the application component contract — pages, islands and primitives are all Custom Elements authored once and rendered on the server.

### `@element`

The class decorator that registers a Custom Element and declares its root mode (shadow-open today, light DOM where declared).

### `@property`

The field decorator that declares reactive state: attribute reflection, type conversion and re-render on change. Host attributes restore into `@property` fields on upgrade.

### Shadow root

The encapsulated DOM subtree a Custom Element owns. Server output carries it inside a DSD template; the browser parses it natively before any script loads.

## Rendering

### Declarative Shadow DOM (DSD)

HTML-carried shadow roots via `<template shadowrootmode>`. The default server representation: first paint needs no JavaScript.

### SSG

Static site generation: routes render to HTML at build time. openElement is static-first; request-time rendering is the exception, not the default.

### Upgrade

The browser mechanism that turns a parsed host element into a live component instance. The claim binds the compiled template's handlers against the already-present DOM instead of re-rendering it.

### Part Program

The compiled per-component program shared by server serialization and client claim: one description of DOM, bindings and handlers, executed twice, written once.

## Islands

### Island

A client component that needs runtime state or framework interop. Everything else ships as static DSD with no client module. Islands are the only client JavaScript units.

### `defineIslandConfig`

The opt-in declared next to the component it exports (`{ hydrate, ssr, dsd }`). The build records the outcome per page in the island manifest.

### Hydration strategy

When an island's chunk is fetched: `load` (immediately, for first-paint controls), `idle` (browser idle), `visible` (near viewport), `only` (skip SSR — browser-only components).

### Component layer

What the server writes and what the client later claims: `dsd-static` (never loads a module), `dsd-interactive` (DSD plus compiled claim), `light-dom` (no shadow boundary, document styles apply), `pure-island` (server writes host tag and props; client owns rendering).

### Island manifest

One JSON artifact per page, emitted next to the HTML, carrying the route and each island's tag, chunk URL, layer and strategy. It answers which JavaScript a page loads, and when, without opening the client bundle.

## Content

### `trustedHtml`

The explicit boundary for pre-sanitized, non-interactive HTML injection into a compiled template. Dynamic island content otherwise comes from signal-driven `@property` state.

## See also

- [Core Concepts](/guide/core-concepts) — the authoring model these terms belong to.
- [Island Hydration](/architecture/islands) — layers, strategies and the manifest.
- [DSD Rendering](/architecture/dsd) — the server-side platform contract.
