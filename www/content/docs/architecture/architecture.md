---
title: 'Current Architecture'
lede: 'OpenElement is a Web Components-native, static-first application framework. Custom Elements are the durable component contract; JSX and Basic Element are authoring modes; Vite and Nitro are the official build and output path.'
navLabel: 'Architecture'
order: 10
---

> Applies to {{OPENELEMENT_VERSION}}.

## Package graph

Dependency direction — consumers point at what they use.

<figure class="diagram" aria-hidden="true"><svg viewBox="0 0 144 88" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="22" cy="20" r="9"/><circle cx="122" cy="20" r="9"/><circle cx="72" cy="74" r="9"/><path d="M31 26l29 9"/><path d="M113 26l-29 9"/><path d="M72 52v13"/><g style="color:var(--brand)"><circle cx="72" cy="40" r="12"/><circle cx="72" cy="40" r="3.5" fill="currentColor" stroke="none"/></g></svg></figure>

| Package                | Role                          | Depends on                  |
| ---------------------- | ----------------------------- | --------------------------- |
| `@openelement/element` | runtime · zero framework deps | —                           |
| `@openelement/router`  | pages · routing · build       | uses `@openelement/element` |
| `@openelement/ui`      | optional primitives           | optional                    |
| `@openelement/create`  | starter · build time          | —                           |

> Retired: `core` · `signal` · `protocol` · `content` · `ssg` · `app` ·
> `adapter-vite` · `app/preact` · `app/spa`.

## Deep modules hide implementation complexity.

Authors use product interfaces. Renderer, router, signal, content and
build-phase details stay internal until real variation proves a public seam.

| Layer       | Package                                           | Scope                                                                                            |
| ----------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| element     | `@openelement/element`                            | One authoring surface for Custom Elements, JSX, DSD, hydration and signals.                      |
| application | `@openelement/router`                             | Pages, routes, islands and render semantics for complete applications.                           |
| build       | `@openelement/router`                             | Vite integration, static generation and deployable Nitro output behind one build boundary.       |
| adoption    | `@openelement/create`, optional `@openelement/ui` | Starter-first adoption and optional primitives; neither exposes retired implementation packages. |

## Web Components are the application architecture.

The roadmap earns WC fullstack leadership through compatibility evidence,
complete application loops and portable operations—not a growing package count.

### WC SSR

The current line classifies admitted standard, Lit, FAST and Stencil elements
for DSD, light DOM or client-only rendering with actionable diagnostics and
corpus evidence — a contract first shipped on the 0.43 line and kept green by CI
on the compiled line.

### Application loop

Routes, data, progressive forms, actions, redirects and revalidation form one
deep App interface rather than separate shallow packages.

### Portable output

Node and Workers output is verified from packed public artifacts. Provider-owned
recovery is proven in the reference stack; framework-owned cache/recovery APIs
remain unassigned and require a future decision record.

## Current truth is checked mechanically.

Package surface, docs truth, artifacts, critical paths and browser tests reject
a return to the retired product graph.

| Gate         | Requirement                                                                            |
| ------------ | -------------------------------------------------------------------------------------- |
| 4 packages   | Current consumer surface, starter and docs agree.                                      |
| output split | The static/request-time output split is frozen; the 0.41.x static freeze is untouched. |
| 3 browsers   | Candidate releases require Chromium, Firefox and WebKit proof.                         |
| packed proof | Consumers build from public artifacts, not workspace aliases.                          |

## Package compatibility

OpenElement treats third-party Custom Elements as standards-based dependencies. Current builds use explicit package-island configuration and available Custom Elements Manifest metadata for SSR admission.

### Current contract

`@openelement/element` owns authoring; the `router` package keeps application and build behavior behind one boundary.

### Explicit admission

Known packages can be configured as package islands and use available CEM metadata without importing retired package surfaces.

### Current diagnostics

The current line ships Universal DSD/light/client-only classification,
hydration-mismatch diagnostics and the tracked third-party WC SSR corpus —
first shipped on the 0.43 line and kept green by CI on the compiled line.
Admission still depends on explicit package-island configuration and observed
metadata; it is not a blanket certification of every third-party component.

## See also

- [openElement vs Alternatives](/architecture/comparison) — how this architecture is positioned.
- [DSD Rendering](/architecture/dsd) — the platform standards contract this graph builds on.
- [Core Concepts](/guide/core-concepts) — the same model from an author's side.
