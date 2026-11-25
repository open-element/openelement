---
title: 'Current Architecture'
lede: 'Web Components-native, static-first framework: Custom Elements are the durable contract, compiled JSX the authoring model, Vite and Nitro the build path.'
navLabel: 'Architecture'
order: 10
---

> Applies to {{OPENELEMENT_VERSION}}.

## Package graph

Dependency direction — consumers point at what they use.

<figure class="diagram" aria-hidden="true"><svg viewBox="0 0 144 88" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="22" cy="20" r="9"/><circle cx="122" cy="20" r="9"/><circle cx="72" cy="74" r="9"/><path d="M31 26l29 9"/><path d="M113 26l-29 9"/><path d="M72 52v13"/><g style="color:var(--color-primary)"><circle cx="72" cy="40" r="12"/><circle cx="72" cy="40" r="3.5" fill="currentColor" stroke="none"/></g></svg></figure>

| Package                  | Role                  | Depends on                                                    |
| ------------------------ | --------------------- | ------------------------------------------------------------- |
| `@openelement/protocol`  | contracts · zero deps | —                                                             |
| `@openelement/element`   | runtime               | uses `@openelement/protocol`                                 |
| `@openelement/compiler`  | build-time compiler   | uses `@openelement/protocol`; TypeScript is its only host dep |
| `@openelement/router`    | pages · routing · build | uses `@openelement/element`, `@openelement/compiler`        |
| `@openelement/ui`        | optional primitives   | optional `@openelement/element`                              |
| `@openelement/create`    | starter · build time  | —                                                             |

## Deep modules hide implementation complexity.

Authors use product interfaces. Renderer, router, signal, content and
build-phase details stay internal until real variation proves a public seam.

| Layer       | Package                                           | Scope                                                                                            |
| ----------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| contracts   | `@openelement/protocol`                           | Shared contracts for rendering, routing, and diagnostics.        |
| element     | `@openelement/element`                            | One authoring surface for Custom Elements, JSX, DSD, hydration and signals.                      |
| build       | `@openelement/compiler`                           | Compiles TSX into server renderers and Custom Element lifecycle functions.    |
| application | `@openelement/router`                             | Pages, routes, islands, render semantics and build orchestration for complete applications.      |
| output      | `@openelement/router`                             | Vite integration, static generation and deployable Nitro output behind one build boundary.       |
| adoption    | `@openelement/create`, optional `@openelement/ui` | Starter scaffolding and optional primitives. |

## Web Components are the application architecture.

The roadmap extends the Web Components fullstack scope through compatibility evidence,
complete application loops and portable operations—not a growing package count.

### WC SSR

The build classifies admitted components for DSD, light DOM or client-only rendering. Browser tests exercise the upgrade of standard, Lit, FAST and Stencil elements.

### Application loop

Routes, data, progressive forms, actions, redirects and revalidation form one
deep App interface rather than separate shallow packages.

### Portable output

Node and Workers output is verified from packed public artifacts. Provider-owned
recovery is proven in the reference stack; framework-owned cache/recovery APIs
remain unassigned and require a future decision record.

## Current truth is checked mechanically.

Release checks cover package exports, documentation, deployable artifacts and application behavior in browsers.

| Gate         | Requirement                                                                            |
| ------------ | -------------------------------------------------------------------------------------- |
| {{PACKAGE_COUNT}} packages | Current consumer surface (protocol/element/compiler/router/create/ui), starter and docs agree. |
| output split | Static HTML and browser assets are public. Request-time modules stay on the server. |
| 3 browsers   | Candidate releases require Chromium, Firefox and WebKit proof.                         |
| packed proof | Consumers build from public artifacts, not workspace aliases.                          |

## Package compatibility

OpenElement treats third-party Custom Elements as standards-based dependencies. Current builds use explicit package-island configuration and available Custom Elements Manifest metadata for SSR admission.

### Current contract

Compiler generates renderers and lifecycle functions. Element supplies the Custom Element runtime, and Router owns application and build behavior.

### Explicit admission

Known packages can be configured as package islands and use available CEM metadata.

### Current diagnostics

The build reports DSD, light DOM or client-only classification and hydration mismatches. Admission depends on the package-island configuration and the metadata available for that package.

## See also

- [openElement vs Alternatives](/architecture/comparison) — how this architecture is positioned.
- [DSD Rendering](/architecture/dsd) — the platform standards contract this graph builds on.
- [Core Concepts](/guide/core-concepts) — the same model from an author's side.
