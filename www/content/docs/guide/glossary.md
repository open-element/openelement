---
title: 'Glossary'
lede: 'The words the docs use, defined once. Each term names a real construct in the framework — not a marketing synonym.'
navLabel: 'Glossary'
order: 65
section: 'Core'
---

## Components

### Custom Element

A browser component registered by a hyphenated tag name. openElement compiles a function component and its `defineIslandConfig` declaration into a Custom Element. Server function pages can compose those elements.

### Signal

A reactive value used for component state. The compiler tracks the template sites that read it and updates their DOM slots when the value changes.

### Shadow root

The encapsulated DOM subtree a Custom Element owns. Server output carries it inside a DSD template; the browser parses it natively before any script loads.

## Rendering

### Declarative Shadow DOM (DSD)

HTML-carried shadow roots via `<template shadowrootmode>`. The server representation of a component that declares an explicit shadow mode (light DOM is the current compiled default): DSD content paints and reads before any script; handlers and signals bind at upgrade.

### SSG

Static site generation: routes render to HTML at build time. openElement is static-first; request-time rendering is the exception, not the default.

### Upgrade

The browser mechanism that turns a parsed host element into a live component instance. The claim binds the compiled template's handlers against the already-present DOM instead of re-rendering it.

### Generated renderer

The compiler emits a server renderer and browser mount, claim and update functions from the same component.

## Islands

### Island

A component whose browser activation can be scheduled independently. The application can also load a shared bootstrap.

### `defineIslandConfig`

The opt-in declared next to the component it exports (`{ hydrate, ssr, dsd }`). The build records the outcome per page in the island manifest.

### Hydration strategy

When an island's chunk is fetched: `load` (immediately, for first-paint controls), `idle` (browser idle), `visible` (near viewport), `media` (while the query declared in the island's `media` field matches), `only` (skip SSR — browser-only components).

### Component layer

What the server writes and what the client later claims: `dsd-static` (never loads a module), `dsd-interactive` (DSD plus compiled claim), `light-dom` (no shadow boundary, document styles apply), `pure-island` (server writes host tag and props; client owns rendering).

### Island manifest

One JSON artifact per page, emitted next to the HTML, carrying the route and each island's tag, chunk URL, layer and strategy. It answers which JavaScript a page loads, and when, without opening the client bundle.

## Content

### `trustedHtml`

The explicit trust boundary for inserting pre-sanitized HTML during server rendering.

## See also

- [Core Concepts](/guide/core-concepts) — the authoring model these terms belong to.
- [Island Hydration](/guide/islands-and-ssr) — layers, strategies and the manifest.
- [DSD Rendering](/architecture/dsd) — the server-side platform contract.
