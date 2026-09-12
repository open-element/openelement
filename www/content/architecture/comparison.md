---
title: 'openElement vs Alternatives'
lede: 'A conservative comparison of product direction. This page describes what each framework optimizes for; it does not invent benchmark claims. Use it to understand fit, not to rank speed.'
order: 20
---

## Framework decision surface

**openElement — WC-native application framework**

| Aspect         | Description                                                                                                                                                                                                                             |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture   | Custom Elements + Declarative Shadow DOM are first-class; standard Custom Elements remain the application contract; App owns routes and rendering; Vite and Nitro are the official build path.                                          |
| Rendering      | SSG by default, DSD/shadow default, selective element upgrades, and static output with no framework JavaScript when interaction is unnecessary.                                                                                         |
| DX             | JSX + compiled Custom Element classes, `@element` / `definePage` / `defineApp` / `buildApp`.                                                                                                                                            |
| Fit            | The Web Components-native, static-first application framework for delivering DSD-first applications on a standard Custom Element contract; current scope is static-first, not generic fullstack parity with Next.js, Nuxt or SvelteKit. |
| Fullstack path | OpenElement × Supabase × Cloudflare: OpenElement owns the application UX, Supabase owns data/Auth/RLS/Storage/Realtime, Cloudflare owns edge/security/cache/async. Providers, never built-in framework features.                        |

| Framework                                         | Architecture                                                                                                              | Rendering                                                                    | DX                                                             | Lock-in / fit                                                                                                                                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Next.js** — React meta-framework                | File-based routing, React Server Components, app router, server actions.                                                  | SSR / SSG / ISR, RSC streaming, client components hydrated on the client.    | React/JSX, large ecosystem, first-class on Vercel.             | React runtime plus Next.js abstractions; platform affinity with Vercel.                                                                                                              |
| **Nuxt** — Vue meta-framework                     | File routing, Vue Single-File Components, Nitro server engine.                                                            | SSR / SSG / ISR, hybrid rendering, client hydration.                         | Vue SFCs, auto-imports, convention-driven.                     | Vue runtime plus Nuxt and Nitro conventions.                                                                                                                                         |
| **SvelteKit** — Svelte meta-framework             | File routing, Svelte components, Vite, adapter-based deployment.                                                          | SSR / SSG / CSR, progressive hydration, no virtual DOM.                      | Svelte compiler, concise syntax, small runtime.                | Svelte compiler/runtime; deploy adapters are swappable (lower lock-in than Next.js).                                                                                                 |
| **Astro** — Islands / content engine              | File routing, multi-framework islands, content collections.                                                               | Static-first, island hydration, server islands, View Transitions.            | `.astro` components, framework-agnostic islands, Markdown/MDX. | Low — islands can be any framework; some Astro-specific component syntax.                                                                                                            |
| **Fresh** — Deno + Preact                         | File routing, Preact islands, Deno-native, zero build step.                                                               | SSR with Preact islands; minimal client JavaScript by default.               | Preact/TypeScript, Deno runtime, no bundler config.            | Deno runtime plus Preact; islands are Preact components.                                                                                                                             |
| **Lit** — Web Components base                     | Base class for Custom Elements with reactive properties; application routing is deliberately outside its component model. | Lit provides SSR tooling with server-specific authoring constraints.         | TypeScript, decorators, tagged-template rendering.             | Low — pure standards Web Components; no framework of its own.                                                                                                                        |
| **Enhance** — HTML-first Web Components fullstack | Custom Elements, file-based routes and server-side Custom Elements.                                                       | SSR to Web Components, zero-JS by default, progressive enhancement.          | HTML-first, single-file components, minimal abstraction.       | Low — standards Web Components; Enhance adds helpers, not a runtime.                                                                                                                 |
| **Stencil** — Web Components compiler             | Compiler that outputs standards Web Components; framework-agnostic output.                                                | Client Web Components with prerendering, lazy loading, internal virtual DOM. | TSX, decorators, design-system oriented tooling.               | Output is lock-in-free Web Components; authoring uses the Stencil toolchain.                                                                                                         |
| **FAST / Web Awesome** — Component systems        | FAST provides Web Component authoring foundations; Web Awesome distributes a component library and design assets.         | —                                                                            | —                                                              | Choose either when your primary need is a component system. OpenElement does not replace an established design system and should be evaluated as an app framework around components. |

## How to read this

- **Architecture** — how routing, components, and the server are composed.
- **Rendering** — SSR/SSG/CSR defaults, hydration, and island strategy.
- **DX** — language, tooling, and learning curve.
- **Lock-in** — how tied you are to a proprietary runtime or platform versus open standards.

## Three groups, three different questions

- **Lit / FAST / Stencil** are component layers, not the same application contract. They author or compile Custom Elements and deliberately leave routing, data and the application loop outside their model; openElement builds its application contract on the same standard, so these compose with it rather than compete.
- **Astro / Fresh / Enhance** are static-first or HTML-first baselines with a different durable component model — framework-specific component formats or framework-tied islands. In openElement the durable model is the standard Custom Element itself, with DSD as the default server representation.
- **Next / Remix / Nuxt / SvelteKit** are broader framework-specific fullstack ecosystems. openElement does not claim generic parity with them; its fullstack story is an explicit, evidence-backed composition with external providers.

## Decision criteria

- Choose **openElement** when Web Components are the public integration surface and SSR output should preserve browser-native component boundaries.
- Choose **Astro / Enhance / Lit / Stencil** when a standards-first Web Components story matters and you want to avoid a heavy application runtime.
- Choose **Next.js / Nuxt / SvelteKit** when your product is intentionally built around a React, Vue, or Svelte application model.
- Choose **Fresh** when you want a Deno-native, near-zero-build Preact island experience.
- Do not choose **openElement** when a mature ecosystem, a framework-specific UI runtime, or a ready-made enterprise design system is the main requirement. Teams adopting the stable 0.43 line should validate the documented starter and deployment path against their own production environment.

## The official composition path

OpenElement × Supabase × Cloudflare is the verified fullstack delivery path, with explicit ownership boundaries: OpenElement owns the application UX; Supabase owns data, Auth, RLS, Storage and Realtime; Cloudflare owns edge delivery, security, cache and async execution. Supabase and Cloudflare are composed providers — never built-in framework features — and a tier-1 boundary gate keeps provider code out of the framework packages.

First shipped on the 0.43 line together with Universal WC SSR and carried by the current compiled line. Framework-owned
production-runtime recovery and cache semantics remain outside the current
contract and have no assigned release version.

- [Supabase recipe](https://github.com/open-element/openelement/blob/main/docs/integrations/supabase.md)
- [Verified reference app](https://github.com/open-element/openelement/tree/main/examples/supabase-cloudflare-starter)
- [Real-project qualification workflow](https://github.com/open-element/openelement/blob/main/.github/workflows/supabase-project-smoke.yml)
- [Real Workers deploy smoke (green run 31925944647)](https://github.com/open-element/openelement/blob/main/.github/workflows/fullstack-deploy-smoke.yml)
- [Tier-1 boundary gate](https://github.com/open-element/openelement/blob/main/tools/check-fullstack-boundary.ts)
- [ADR-0129 response-header channel](https://github.com/open-element/openelement/blob/main/docs/adr/ADR-0129-response-header-channel.md)

## Evidence behind the position

- Custom Elements as the durable application contract — the static surface froze under ADR-0119 and the request-time application loop under ADR-0122. [ADR-0119 / ADR-0122 freezes](https://github.com/open-element/openelement/blob/main/docs/adr/ADR-0122-0-42-0-stable-scope-freeze.md)
- DSD-first SSR with selective upgrade, and explicit foreign-WC admission — the corpus pins the observed SSR form and admission of each third-party library kind as machine-readable evidence. [Third-party WC SSR corpus](https://github.com/open-element/openelement/blob/main/docs/evidence/third-party-wc-ssr-corpus.json)
- Browser and packaged-artifact qualification — candidate releases prove Chromium, Firefox and WebKit, and consumers build from packed public artifacts. [Stack contract](https://github.com/open-element/openelement/blob/main/docs/current/STACK_CONTRACT.md)
- A composable provider stack instead of framework-owned Auth or database packages — verified end to end by the reference app and its real-provider smokes. [Supabase × Cloudflare reference app](https://github.com/open-element/openelement/tree/main/examples/supabase-cloudflare-starter)

## Sources and review scope

Reviewed 2026-08-16 against primary project documentation. This is a decision guide, not a benchmark or compatibility certification.

- [Lit documentation](https://lit.dev/docs/)
- [Stencil documentation](https://stenciljs.com/docs/introduction)
- [FAST documentation](https://www.fast.design/docs/fast-element/getting-started)
- [Enhance documentation](https://enhance.dev/docs/)
- [Astro islands documentation](https://docs.astro.build/en/concepts/islands/)
- [Fresh documentation](https://docs.deno.com/runtime/frameworks/fresh/)
- [Web Awesome documentation](https://webawesome.com/docs/)
