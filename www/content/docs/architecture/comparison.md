---
title: 'openElement vs Alternatives'
lede: 'A conservative comparison of product direction: what each framework optimizes for, without invented benchmark claims. Use it to judge fit, not to rank speed.'
navLabel: 'Comparison'
order: 20
---

## Framework decision surface

**openElement — WC-native application framework**

| Aspect         | Description                                                                                                                                                                                                                             |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture   | Custom Elements + Declarative Shadow DOM are first-class; standard Custom Elements remain the application contract; Router owns routes and rendering; Vite and Nitro are the official build path.                                       |
| Rendering      | SSG by default, DSD/shadow as an explicit first-class mode (light DOM is the current compiled default), selective element upgrades, and static output with no framework JavaScript when interaction is unnecessary.                     |
| DX             | TSX page functions and compiler-generated Custom Elements with `definePage`, `defineIslandConfig` and `buildApp`.                                                                                                                                                          |
| Fit            | The Web Components-native, static-first application framework for delivering DSD-first applications on a standard Custom Element contract; current scope is static-first, not generic fullstack parity with Next.js, Nuxt or SvelteKit. |
| Fullstack path | OpenElement × Supabase × Cloudflare: OpenElement owns the application UX, Supabase owns data/Auth/RLS/Storage/Realtime, Cloudflare owns edge/security/cache/async. Providers, never built-in framework features.                        |

| Framework                                         | Architecture                                                                                                              | Rendering                                                                    | DX                                                             | Lock-in / fit                                                                                                                                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Next.js** — React meta-framework                | File-based routing, React Server Components, app router, server actions.                                                  | SSR / SSG / ISR, RSC streaming, client components hydrated on the client.    | React/JSX, large ecosystem, first-class on Vercel.             | React runtime plus Next.js abstractions; platform affinity with Vercel.                                                                                                              |
| **Nuxt** — Vue meta-framework                     | File routing, Vue Single-File Components, Nitro server engine.                                                            | SSR / SSG / ISR, hybrid rendering, client hydration.                         | Vue SFCs, auto-imports, convention-driven.                     | Vue runtime plus Nuxt and Nitro conventions.                                                                                                                                         |
| **SvelteKit** — Svelte meta-framework             | File routing, Svelte components, Vite, adapter-based deployment.                                                          | SSR / SSG / CSR with hydration; compiled components (Svelte compiler).                      | Svelte compiler, concise syntax, small runtime.                | Svelte compiler/runtime; deploy adapters are swappable (lower lock-in than Next.js).                                                                                                 |
| **Astro** — Islands / content engine              | File routing, multi-framework islands, content collections.                                                               | Static-first, island hydration, server islands, View Transitions.            | `.astro` components, framework-agnostic islands, Markdown/MDX. | Low — islands can be any framework; some Astro-specific component syntax.                                                                                                            |
| **Fresh** — Deno + Preact                         | File routing, Preact islands, Deno-native framework.                                                               | SSR with Preact islands; minimal client JavaScript by default.               | Preact/TypeScript on the Deno runtime; Fresh owns routing, rendering and client bundling.            | Deno runtime plus Preact; islands are Preact components.                                                                                                                             |
| **Lit** — Web Components base                     | Base class for Custom Elements with reactive properties; application routing is deliberately outside its component model. | SSR tooling via @lit-labs/ssr; authoring stays Lit-specific.         | TypeScript, decorators, tagged-template rendering.             | Low — pure standards Web Components; no framework of its own.                                                                                                                        |
| **Enhance** — HTML-first Web Components fullstack | Custom Elements, file-based routes and server-side Custom Elements.                                                       | SSR to Web Components, zero-JS by default, progressive enhancement.          | HTML-first, single-file components, minimal abstraction.       | Low — standards Web Components; Enhance adds helpers, not a runtime.                                                                                                                 |
| **Stencil** — Web Components compiler             | Compiler that outputs standards Web Components; framework-agnostic output.                                                | Client Web Components with prerendering; Stencil compiler/runtime. | TSX, decorators, design-system oriented tooling.               | Output is lock-in-free Web Components; authoring uses the Stencil toolchain.                                                                                                         |
| **FAST / Web Awesome** — Component systems        | FAST provides Web Component authoring foundations; Web Awesome distributes a component library and design assets.         | —                                                                            | —                                                              | Choose either when your primary need is a component system. OpenElement does not replace an established design system and should be evaluated as an app framework around components. |

## How to read this

- **Architecture** — how routing, components, and the server are composed.
- **Rendering** — SSR/SSG/CSR defaults, hydration, and island strategy.
- **DX** — language, tooling, and learning curve.
- **Lock-in** — how tied you are to a proprietary runtime or platform versus open standards.

## Three groups, three different questions

- **Lit / FAST / Stencil** are component layers, not the same application contract. They author or compile Custom Elements and leave routing, data and the application loop outside their component model; openElement builds its application contract on the same standard, so these compose with it rather than compete.
- **Astro / Fresh / Enhance** are static-first or HTML-first baselines with a different durable component model — framework-specific component formats or framework-tied islands. In openElement the durable model is the standard Custom Element itself, with DSD as the server expression of an explicitly declared shadow mode (light DOM is the current compiled default).
- **Next / Remix / Nuxt / SvelteKit** are broader framework-specific fullstack ecosystems. openElement does not claim generic parity with them; its fullstack story is an explicit, evidence-backed composition with external providers.

## Decision criteria

- Choose **openElement** when Web Components are the public integration surface and SSR output should preserve browser-native component boundaries.
- Choose **Astro / Enhance / Lit / Stencil** when a standards-first Web Components story matters and you want to avoid a heavy application runtime.
- Choose **Next.js / Nuxt / SvelteKit** when your product is intentionally built around a React, Vue, or Svelte application model.
- Choose **Fresh** when you want a Deno-native Preact island experience.
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
- Browser and packaged-artifact qualification — candidate releases prove Chromium, Firefox and WebKit, and consumers build from packed public artifacts. [Release workflow](https://github.com/open-element/openelement/blob/main/.github/workflows/autoflow-release.yml)
- A composable provider stack instead of framework-owned Auth or database packages — implemented and unit-tested by the first-party SaaS consumer; hosted and deployed qualification is external pending, and the consumer's README records that qualification status. [Supabase × Cloudflare SaaS](https://github.com/open-element/openelement/tree/main/apps/saas)

## Sources and review scope

Reviewed 2026-10-29 against primary project documentation (each claim re-checked against the project's current docs; wording that could not be confirmed there was narrowed or removed). This is a decision guide, not a benchmark or compatibility certification.

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

Measured on 2026-11-25 from the docs site's own build (`vp run site:build`). Total static output is the sum of every regular file under `www/dist`, including hidden build metadata. The figures and search index are inside the measured tree, so writing down a new total may move the next build by a few bytes. `check:doc-figures` allows ±1% for the total and checks the page, URL and manifest counts exactly.

| Metric                 | Value                                               |
| ---------------------- | --------------------------------------------------- |
| Pre-rendered documents | 78 HTML files                                       |
| URLs in `sitemap.xml`  | 76                                                  |
| Total static output    | 13.0 MiB (13,665,658 B)                             |
| Island manifests       | 78 — one per page                                   |
| Search index           | 38 pages per locale (en, zh), 76 fragments, 1.8 MiB |

```bash
# Regenerate everything below first.
vp run site:build
find www/dist -name '*.html' | wc -l        # 78
grep -c '<loc>' www/dist/sitemap.xml        # 76
find www/dist -type f -exec wc -c {} + | tail -1   # 13,665,658 B total (the byte sum above)
ls www/dist/island-manifests | wc -l        # 78
cat www/dist/pagefind/pagefind-entry.json   # page_count 38 per language
```

### Island bundles

The docs site builds with OpenElement. These are the raw and gzip sizes of its island chunks, shared entry and element runtime.

| Chunk                          | Raw bytes | gzip -9 |
| ------------------------------ | --------- | ------- |
| `element-runtime`              | 68,475    | 21,842  |
| `island-open-button`           | 16,432    | 3,747   |
| `island-open-page-rail`        | 35,269    | 6,713   |
| `island-open-code-block`       | 8,123     | 2,593   |
| `island-open-counter`          | 5,126     | 1,783   |
| `island-open-search`           | 51,060    | 9,992  |
| `island-open-theme-toggle`     | 21,873    | 4,452   |
| `client.js`                    | 7,914     | 2,720   |

```bash
ls -l www/dist/client/islands/*.js
gzip -9 -c www/dist/client/islands/client.js | wc -c
```

The shared compiled-element runtime ships in its own chunk. Search loads its combobox runtime (about 99 KiB raw, 32 KiB gzip) when first opened. Component stylesheets are emitted separately under `client/assets/` (ADR-0164). The figure gate allows ±1% for raw bytes and ±3% for gzip bytes.

What a page actually downloads follows from its island manifest plus the entry's eager (static) imports — the payload rows are measured as that import closure, so they do not depend on which chunk file hosts shared code:

| Route                    | Client payload (raw) | Distinct chunks |
| ------------------------ | -------------------- | --------------- |
| `/guide/mdx`             | 194,075 B            | 8               |
| `/guide/getting-started` | 194,075 B            | 8               |
| `/`                      | 199,201 B            | 9               |

Across 78 page manifests the site declares 6 island tags in 290 entries. There is an `open-search` and an `open-theme-toggle` on every page, `open-page-rail` on 68 pages, `open-code-block` on 56 pages `open-button` on 8 pages and `open-counter` on both language versions of the homepage.

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
