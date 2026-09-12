---
title: 'Current Architecture'
lede: 'OpenElement is a Web Components-native, static-first application framework. Custom Elements are the durable component contract; JSX and Basic Element are authoring modes; Vite and Nitro are the official build and output path.'
order: 10
---

> Applies to {{OPENELEMENT_VERSION}}.

## Package graph

Dependency direction — consumers point at what they use.

| Package                     | Role                          | Depends on                   |
| --------------------------- | ----------------------------- | ---------------------------- |
| `@openelement/element`      | runtime · zero framework deps | —                            |
| `@openelement/app`          | pages · routing               | uses `@openelement/element`  |
| `@openelement/adapter-vite` | the only host side            | builds on `@openelement/app` |
| `@openelement/ui`           | optional primitives           | optional                     |
| `@openelement/create`       | starter · build time          | —                            |

> Retired: `core` · `signal` · `router` · `protocol` · `content` · `ssg`.

## Deep modules hide implementation complexity.

Authors use product interfaces. Renderer, router, signal, content and build-phase details stay internal until real variation proves a public seam.

| Layer       | Package                                           | Scope                                                                                               |
| ----------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| element     | `@openelement/element`                            | One authoring surface for Custom Elements, JSX, DSD, hydration and signals.                         |
| application | `@openelement/app`                                | Pages, routes, islands and render semantics for complete applications.                              |
| build       | `@openelement/adapter-vite`                       | Vite integration, content, static generation and deployable Nitro output behind one build boundary. |
| adoption    | `@openelement/create`, optional `@openelement/ui` | Starter-first adoption and optional primitives; neither exposes retired implementation packages.    |

## Web Components are the application architecture.

The roadmap earns WC fullstack leadership through compatibility evidence, complete application loops and portable operations—not a growing package count.

### WC SSR

The current line classifies admitted standard, Lit, FAST and Stencil elements for DSD, light DOM or client-only rendering with actionable diagnostics and corpus evidence — a contract first shipped on the 0.43 line and kept green by CI on the compiled line.

### Application loop

Routes, data, progressive forms, actions, redirects and revalidation form one deep App interface rather than separate shallow packages.

### Portable output

Node and Workers output is verified from packed public artifacts. Provider-owned recovery is proven in the reference stack; framework-owned cache/recovery APIs remain unassigned and require a future ADR.

## Current truth is checked mechanically.

Package surface, docs truth, artifacts, critical paths and browser tests reject a return to the retired product graph.

| Gate         | Requirement                                                                     |
| ------------ | ------------------------------------------------------------------------------- |
| 5 packages   | Current consumer surface, starter and docs agree.                               |
| ADR-0122     | 0.42.0 frozen (ACCEPTED); the 0.41.x static freeze under ADR-0119 is untouched. |
| 3 browsers   | Candidate releases require Chromium, Firefox and WebKit proof.                  |
| packed proof | Consumers build from public artifacts, not workspace aliases.                   |
