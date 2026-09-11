# @openelement/adapter-vite

openElement build orchestration for Vite.

> Stable surface (frozen under ADR-0122):
> advanced Framework infrastructure. First-run apps should use
> `openElement()` from this package's root export or generated `@openelement/create`
> tasks instead of wiring the internal plugins by hand.

This package scans routes and islands, generates virtual entries, builds client
island chunks, runs SSG, and writes post-processed HTML. It is build-time
infrastructure; runtime primitives live in `@openelement/element`.

## Install

```bash
npm install @openelement/adapter-vite
```

## Usage

```ts
import { openElement } from '@openelement/adapter-vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    openElement({
      routesDir: 'app/routes',
      islandsDir: 'app/islands',
      componentsDir: 'app/components',
      packageIslands: ['@acme/components'],
    }),
  ],
});
```

`openElement()` combines the core adapter, content pipeline, and i18n with one
shared build context. For a leaner setup without the content/i18n modules, use
`openPipeline()` from the same root export.

## Nitro Deploy Adapter

Nitro is the first-party production deployment adapter proven by this package's
Node and Workers fixtures. Import the Nitro bridge from the explicit subpath:

```ts
import { createOpenElementNitroHandler } from '@openelement/adapter-vite/nitro-mount';
```

## Main Options

| Option           | Default            | Purpose                                         |
| ---------------- | ------------------ | ----------------------------------------------- |
| `routesDir`      | `'app/routes'`     | Page routes, API routes, renderers, middleware. |
| `islandsDir`     | `'app/islands'`    | Local Custom Elements for client upgrade.       |
| `componentsDir`  | `'app/components'` | Shared server-rendered components.              |
| `packageIslands` | `[]`               | Packages exporting an openElement `manifest`.   |
| `html`           | `{}`               | Document metadata.                              |
| `inject`         | none               | Structured stylesheet/script/head injection.    |
| `middleware`     | none               | Hono middleware configuration.                  |

## SSG Pipeline

The build executes in ADR-0023 order — SSG (Phase 3) runs before the client
bundle (Phase 2), because client chunk hashes do not affect HTML content and
script injection is a post-processing step:

```text
Phase 1: route, API, middleware, and island scan
Phase 3: SSR bundle, Hono toSSG(), HTML post-processing
Phase 2: client island entry and browser chunks
```

## SPA Mode (`mode: 'spa'`)

`mode: 'spa'` skips SSG (Phase 3) entirely — no SSR HTML is rendered. The
`index.html` contract:

- The adapter's client build points `build.rollupOptions.input` at its
  virtual build trigger, so a project-root `index.html` is **not** bundled
  by default. To ship your own shell, override the input (the
  `examples/deno-desktop-reader` form):

  ```ts
  // vite.config.ts — after openPipeline(...)
  {
    name: 'app:entry',
    enforce: 'post',
    config() {
      return { build: { rollupOptions: { input: 'index.html' } } };
    },
  },
  ```

  With that, Vite emits your `index.html` and the adapter **preserves** it
  (it never overwrites an existing file). This is how you attach a custom
  client entry.
- Otherwise the adapter writes a _fallback shell_: a bare `<div id="root">`
  plus a `console.info` placeholder script. It is a build marker so the
  output directory is servable — not a runnable app. Either way, a route
  manifest module (`route-manifest.ts`, exporting ordered `routeRecords`) is
  written next to it for client-side routing; import it from your bootstrap
  as `../dist/route-manifest.ts`.

A minimal custom entry is your own `index.html` plus a bootstrap module:

```html
<!-- index.html (project root) -->
<body>
  <div id="app"></div>
  <script type="module" src="/app/main.ts"></script>
</body>
```

```ts
// app/main.ts — see the SPA bootstrap recipe in the www configuration guide
import { defineApp } from '@openelement/router';

const app = defineApp({
  mode: 'spa',
  routes: [{ path: '/', tagName: 'page-home' }],
});
app.mount('#app');
```

## Build Utilities

```ts
import {
  buildIslandChunkMap,
  extractCustomElementTags,
  generateIslandManifests,
  injectClientScript,
  injectCspMeta,
  scanClientBuild,
  scanSSGOutput,
  writeIslandManifests,
} from '@openelement/adapter-vite';
```

## Registry Boundary

`packageIslands` currently scans packages that export a `manifest` object with
`packageName` and `declarations` (see the island scanner). It should not be
treated as a complete marketplace or registry protocol. Future `open add`
behavior must first validate a CEM-compatible manifest, generate a dry-run diff,
and only then update config and generated registration.

## License

MIT

### Standalone Element authoring

Install Element and Vite; import `element` from `@openelement/element/vite` and
put `element()` in Vite's `plugins`. This entry does not load Router, SSG or
deployment tooling. Router is an optional peer; Framework applications install
`@openelement/router` explicitly.

Keep the decorated component in a `.tsx` module and register its exported class
from a separate JS entry. Use a Vite library build to bundle that entry, then
load the resulting JS from ordinary HTML. The consumer needs the bundled Element
runtime, not the compiler. `deno run -A tools/consumer-packaged-element.ts` in the
repository exercises this path using packed artifacts.
