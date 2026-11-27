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

openElement treats third-party Custom Elements as standards-based dependencies. Current builds use explicit package-island configuration and available Custom Elements Manifest metadata for SSR admission.

### Current contract

Compiler generates renderers and lifecycle functions. Element supplies the Custom Element runtime, and Router owns application and build behavior.

### Explicit admission

Known packages can be configured as package islands and use available CEM metadata.

### Current diagnostics

The build reports DSD, light DOM or client-only classification and hydration mismatches. Admission depends on the package-island configuration and the metadata available for that package.

## See also

- [openElement vs Alternatives](/architecture#framework-comparison-and-measured-output) — how this architecture is positioned.
- [DSD Rendering](/architecture/dsd) — the platform standards contract this graph builds on.
- [Core Concepts](/guide/core-concepts) — the same model from an author's side.

## Framework comparison and measured output

## Framework decision surface

**openElement — WC-native application framework**

| Aspect         | Description                                                                                                                                                                                                                             |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture   | Custom Elements + Declarative Shadow DOM are first-class; standard Custom Elements remain the application contract; Router owns routes and rendering; Vite and Nitro are the official build path.                                       |
| Rendering      | SSG by default, DSD/shadow as an explicit first-class mode (light DOM is the current compiled default), selective element upgrades, and static output with no framework JavaScript when interaction is unnecessary.                     |
| DX             | TSX page functions and compiler-generated Custom Elements with `definePage`, `defineIslandConfig` and `buildApp`.                                                                                                                                                          |
| Fit            | The Web Components-native, static-first application framework for delivering DSD-first applications on a standard Custom Element contract; current scope is static-first, not generic fullstack parity with Next.js, Nuxt or SvelteKit. |
| Fullstack path | openElement × Supabase × Cloudflare: openElement owns the application UX, Supabase owns data/Auth/RLS/Storage/Realtime, Cloudflare owns edge/security/cache/async. Providers, never built-in framework features.                        |

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
| **FAST / Web Awesome** — Component systems        | FAST provides Web Component authoring foundations; Web Awesome distributes a component library and design assets.         | —                                                                            | —                                                              | Choose either when your primary need is a component system. openElement does not replace an established design system and should be evaluated as an app framework around components. |

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

openElement × Supabase × Cloudflare is the first-party fullstack delivery path, with explicit ownership boundaries: openElement owns the application UX; Supabase owns data, Auth, RLS, Storage and Realtime; Cloudflare owns edge delivery, security, cache and async execution. Supabase and Cloudflare are composed providers — never built-in framework features — and the package-graph boundary gate keeps provider code out of the framework packages.

Configure recovery and caching with the deployment provider.

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

Measured on 2026-11-27 from the docs site's own build (`vp run site:build`). Total static output is the sum of every regular file under `www/dist`, including hidden build metadata. The figures and search index are inside the measured tree, so writing down a new total may move the next build by a few bytes. `check:doc-figures` allows ±1% for the total and checks the page, URL and manifest counts exactly.

| Metric                 | Value                                               |
| ---------------------- | --------------------------------------------------- |
| Pre-rendered documents | 66 HTML files                                       |
| URLs in `sitemap.xml`  | 64                                                  |
| Total static output    | 13.6 MiB (14,221,788 B)                              |
| Island manifests       | 66 — one per page                                   |
| Search index           | 32 pages per locale (en, zh), 64 fragments, 1.6 MiB |

```bash
# Regenerate everything below first.
vp run site:build
find www/dist -name '*.html' | wc -l  # 66
grep -o '<loc>' www/dist/sitemap.xml | wc -l  # 64
find www/dist -type f -exec wc -c {} + | awk '$NF != "total" { sum += $1 } END { print sum }'  # 14,221,788 B
find www/dist/island-manifests -name '*.json' | wc -l  # 66
cat www/dist/pagefind/pagefind-entry.json  # page_count 32 per locale
find www/dist/pagefind/fragment -type f | wc -l  # 64
find www/dist/pagefind -type f -exec wc -c {} + | awk '$NF != "total" { sum += $1 } END { print sum }'  # 1,708,345 B
```

### Island bundles

The docs site builds with openElement. These are the raw and gzip sizes of its island chunks, search combobox runtime, shared entry and element runtime.

| Chunk                         | Raw bytes | gzip -9 |
| ----------------------------- | --------- | ------- |
| `element-runtime`             | 66,159    | 21,411  |
| `island-open-button`          | 14,114    | 3,262   |
| `island-open-code-block`      | 7,734     | 2,527   |
| `island-open-copy-button`     | 11,426    | 2,758   |
| `island-open-counter`         | 8,328     | 2,222   |
| `island-open-layer-strip`     | 3,770     | 1,618   |
| `island-open-page-rail`       | 35,951    | 7,504   |
| `island-open-registry-lookup` | 27,462    | 7,206   |
| `island-open-search`          | 84,238    | 16,636  |
| `island-open-site-menu`       | 6,149     | 2,283   |
| `island-open-source-toggle`   | 6,430     | 2,188   |
| `island-open-theme-toggle`    | 18,254    | 3,790   |
| `open-search-combobox`        | 108,612   | 35,531  |
| `client.js`                   | 9,977     | 2,881   |

```bash
for file in www/dist/client/islands/*.js; do
  printf '%s %s %s\n' "$file" "$(wc -c < "$file")" "$(gzip -9 -c "$file" | wc -c)"
done
```

The shared compiled-element runtime ships in its own chunk. Search loads its combobox runtime when first opened. Component stylesheets are emitted separately under `client/assets/` (ADR-0164). The figure gate allows ±1% for raw bytes and ±3% for gzip bytes.

Each route's payload includes all chunks named in its island manifest, the shared client entry and their transitive static imports. The hydration strategy determines when each island loads.

| Route                    | Client payload (raw) | Distinct chunks |
| ------------------------ | -------------------- | --------------- |
| `/guide/mdx`             | 230,065 B            | 9               |
| `/guide/getting-started` | 230,065 B            | 9               |
| `/`                      | 260,083 B            | 13              |

Across 66 page manifests the site declares 11 island tags in 318 entries. Every page declares `open-search`, `open-site-menu` and `open-theme-toggle`. The site declares `open-page-rail` on 52 pages, `open-code-block` on 46 pages and `open-button` on 8 pages. In both languages, the homepage and contributing guide declare `open-copy-button`, and the error and API references declare `open-registry-lookup`. Both versions of the homepage declare `open-counter`, `open-layer-strip` and `open-source-toggle`.

```bash
node --input-type=module <<'JS'
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { clientImportGraph, payloadClosure } from './tools/release/payload-closure.ts';

const dist = 'www/dist';
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const manifestDir = `${dist}/island-manifests`;
const manifests = readdirSync(manifestDir).map((file) => readJson(`${manifestDir}/${file}`));
const graph = clientImportGraph(readJson(`${dist}/client/.vite/manifest.json`));

for (const route of ['/guide/mdx', '/guide/getting-started', '/']) {
  const { islands } = manifests.find((manifest) => manifest.route === route);
  const chunks = payloadClosure(graph, ['/client/islands/client.js', ...islands.map((island) => island.chunkUrl)]);
  const bytes = [...chunks].reduce((sum, url) => sum + statSync(dist + url).size, 0);
  console.log(route, bytes, chunks.size);
}
JS
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
