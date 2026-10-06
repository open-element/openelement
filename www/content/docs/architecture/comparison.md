---
title: 'openElement vs Alternatives'
lede: 'A conservative comparison of product direction. This page describes what each framework optimizes for; it does not invent benchmark claims. Use it to understand fit, not to rank speed.'
navLabel: 'Comparison'
order: 20
---

## Framework decision surface

**openElement — WC-native application framework**

| Aspect         | Description                                                                                                                                                                                                                             |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture   | Custom Elements + Declarative Shadow DOM are first-class; standard Custom Elements remain the application contract; Router owns routes and rendering; Vite and Nitro are the official build path.                                       |
| Rendering      | SSG by default, DSD/shadow as an explicit first-class mode (light DOM is the current compiled default), selective element upgrades, and static output with no framework JavaScript when interaction is unnecessary.                     |
| DX             | JSX + compiled Custom Element classes, `@element` / `definePage` / `buildApp`.                                                                                                                                                          |
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
- **Astro / Fresh / Enhance** are static-first or HTML-first baselines with a different durable component model — framework-specific component formats or framework-tied islands. In openElement the durable model is the standard Custom Element itself, with DSD as the server expression of an explicitly declared shadow mode (light DOM is the current compiled default).
- **Next / Remix / Nuxt / SvelteKit** are broader framework-specific fullstack ecosystems. openElement does not claim generic parity with them; its fullstack story is an explicit, evidence-backed composition with external providers.

## Decision criteria

- Choose **openElement** when Web Components are the public integration surface and SSR output should preserve browser-native component boundaries.
- Choose **Astro / Enhance / Lit / Stencil** when a standards-first Web Components story matters and you want to avoid a heavy application runtime.
- Choose **Next.js / Nuxt / SvelteKit** when your product is intentionally built around a React, Vue, or Svelte application model.
- Choose **Fresh** when you want a Deno-native, near-zero-build Preact island experience.
- Do not choose **openElement** when a mature ecosystem, a framework-specific UI runtime, or a ready-made enterprise design system is the main requirement. Teams evaluating openElement should validate the SaaS consumer and the deployment path against their own production environment.

## The official composition path

OpenElement × Supabase × Cloudflare is the first-party fullstack delivery path, with explicit ownership boundaries: OpenElement owns the application UX; Supabase owns data, Auth, RLS, Storage and Realtime; Cloudflare owns edge delivery, security, cache and async execution. Supabase and Cloudflare are composed providers — never built-in framework features — and the package-graph boundary gate keeps provider code out of the framework packages.

First shipped on the 0.43 line together with Universal WC SSR and carried by the current compiled line. Framework-owned
production-runtime recovery and cache semantics remain outside the current
contract and have no assigned release version.

- [First-party SaaS consumer](https://github.com/open-element/openelement/tree/main/apps/saas)

## Evidence behind the position

- Custom Elements as the durable application contract — the static surface and the request-time application loop are described by the current architecture. [Current architecture](https://github.com/open-element/openelement/tree/main/docs/architecture)
- DSD-first SSR with selective upgrade, and explicit foreign-WC admission — the corpus pins the observed SSR form and admission of each third-party library kind as machine-readable evidence. [Third-party WC interop corpus](https://github.com/open-element/openelement/blob/main/tests/fixtures/web-component-interop/corpus.json)
- Browser and packaged-artifact qualification — candidate releases prove Chromium, Firefox and WebKit, and consumers build from packed public artifacts. [Release procedure](https://github.com/open-element/openelement/blob/main/docs/maintainers/releasing.md)
- A composable provider stack instead of framework-owned Auth or database packages — implemented and unit-tested by the first-party SaaS consumer; hosted and deployed qualification is external pending, and the consumer's README records that qualification status. [Supabase × Cloudflare SaaS](https://github.com/open-element/openelement/tree/main/apps/saas)

## Sources and review scope

Reviewed 2026-08-16 against primary project documentation. This is a decision guide, not a benchmark or compatibility certification.

- [Lit documentation](https://lit.dev/docs/)
- [Stencil documentation](https://stenciljs.com/docs/introduction)
- [FAST documentation](https://www.fast.design/docs/fast-element/getting-started)
- [Enhance documentation](https://enhance.dev/docs/)
- [Astro islands documentation](https://docs.astro.build/en/concepts/islands/)
- [Fresh documentation](https://docs.deno.com/runtime/frameworks/fresh/)
- [Web Awesome documentation](https://webawesome.com/docs/)

## Measured output

What we measure, and the commands that reproduce each row.

### Output size

Numbers measured on 2026-10-06 from the docs site's own build (`www/dist`, built with `pnpm run site:build`). The commands below reproduce each row; page and URL counts follow the route set, so re-run them after content changes. The figures moved five times since alpha6: the alpha6 build made client asset injection manifest-driven with exact package-island identity (#1471, ADR-0160); the alpha8 B2 manifest conversion (pnpm workspaces, no `deno.json` workspace marker) re-cut the app-side island chunks; the alpha8 client build now resolves each package island's declared identity to its real module id before chunk grouping (#1471 fail-closed), so every island chunk is named `island-open-<tag>-<hash>.js` and the shared compiled-element runtime ships as one chunk that `client.js` loads eagerly on every island page; the alpha9 styling train seated the site on the @theme role sheet with the Zag-powered open-search island (#1502), which grows the island chunks and route payloads measured below; and the alpha10 train minified the island component styles (#1543) and gave the shared compiled-element runtime its own `element-runtime-<hash>.js` chunk instead of a berth inside an island chunk (#1544), which re-cut the island rows and route payloads measured below. Route payloads below are measured as the eager import closure of the route's manifest chunk set, so they stay honest no matter which chunk file hosts shared code.

| Metric                 | Value                                              |
| ---------------------- | -------------------------------------------------- |
| Pre-rendered documents | 70 HTML files                                      |
| URLs in `sitemap.xml`  | 68                                                 |
| Total static output    | 8.9 MB                                             |
| Island manifests       | 70 — one per page                                  |
| Search index           | 34 pages per locale (en, zh), 68 fragments, 1.4 MB |

```bash
pnpm run site:build                         # regenerate everything below first
find www/dist -name '*.html' | wc -l        # 70
grep -c '<loc>' www/dist/sitemap.xml        # 68
du -sh www/dist                             # 9.6M (platform-dependent; the 8.9 MB above is the byte sum)
ls www/dist/island-manifests | wc -l        # 70
cat www/dist/pagefind/pagefind-entry.json   # page_count 34 per language
```

### Island bundles

The docs site is a normal openElement app, islands included, so its client output is a fair sample. Raw and gzip sizes of the island chunks plus the shared runtime chunk:

| Chunk                          | Raw bytes | gzip -9 |
| ------------------------------ | --------- | ------- |
| `island-open-layout`           | 100,721   | 17,444  |
| `element-runtime`              | 82,137    | 25,734  |
| `island-open-button`           | 15,776    | 2,923   |
| `island-open-dragon-live-gaze` | 13,238    | 4,823   |
| `island-open-page-rail`        | 9,915     | 2,781   |
| `island-open-cinematic-scroll` | 7,857     | 3,101   |
| `island-open-code-block`       | 7,737     | 2,609   |
| `island-open-badge`            | 6,221     | 1,751   |
| `island-open-hero-polish`      | 4,520     | 1,881   |

```bash
ls -l www/dist/client/islands/*.js
gzip -9 -c www/dist/client/islands/client.js | wc -c
```

The shared entry (`client.js`, ~7 KB) is deliberately not pinned: its island import factories and error strings follow the admitted island set, so its bytes move with that set rather than holding a fixed shape. Since the alpha10 chunk re-grouping (#1544), the shared compiled-element runtime rides its own `element-runtime-<hash>.js` chunk instead of homing inside an island chunk — `client.js` and every island chunk statically import it, so its bytes ride along on every island page regardless of route, and the `island-open-badge-<hash>.js` row now measures the badge island's own bytes. Two emitted files stay out of the table: the ~99 KB search combobox runtime is a dynamic chunk fetched on the first search open, and the 158 B `rolldown-runtime` chunk is bundler plumbing. Per-chunk raw rows tolerate ±1% and gzip rows ±3% for the same class of cross-platform byte variance, route payloads below tolerate ±1%, and chunk counts stay exact.

What a page actually downloads follows from its island manifest plus the entry's eager (static) imports — the payload rows are measured as that import closure, so they do not depend on which chunk file hosts shared code:

| Route                    | Client payload (raw) | Distinct chunks |
| ------------------------ | -------------------- | --------------- |
| `/guide/mdx`             | 221,748 B            | 8               |
| `/guide/getting-started` | 221,748 B            | 8               |
| `/`                      | 229,591 B            | 9               |

Across all 70 page manifests the site declares 10 island tags in 334 entries: the chrome islands (`open-layout`, `open-search`, `open-theme-toggle`) on every page, `open-page-rail` on 60, `open-code-block` on 48, and the remaining tags on a handful of pages each.

```bash
cat www/dist/island-manifests/page-<hash>.json   # one page's island set: tag, chunk, strategy, layer
python3 -c "import json,glob,collections; print(collections.Counter(t for f in glob.glob('www/dist/island-manifests/*.json') for t in (i['tagName'] for i in json.load(open(f))['islands'])))"
```

A project with no islands and no enhanced forms emits no client entry at all: DSD components need no framework virtual-DOM runtime, so pure-static pages stay script-free.

### Rendering

| Metric            | Behavior                                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| DSD SSR           | Components serialize as Declarative Shadow DOM; the browser parses shadow roots natively, with no script cost. |
| Island hydration  | Per component, gated by its declared strategy (`load` / `idle` / `visible` / `only`).                          |
| Navigation        | Browser-native navigation; View Transitions and Speculation Rules stay opt-in.                                 |
| Mandatory runtime | None. Client JavaScript exists only where a module declared an island or a form opted into enhancement.        |

## See also

- [Current Architecture](/architecture) — the package graph this comparison refers to, and the package-compatibility contract it admits.
- [Core Concepts](/guide/core-concepts) — the authoring model behind the position.
- [Island Hydration](/architecture/islands) — the four component layers and their strategies.
- [Design System](/architecture/design-system) — how the site’s own styles and tokens are composed.
