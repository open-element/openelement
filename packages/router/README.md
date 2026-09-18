# @openelement/router

Application authoring API and lifecycle tooling for openElement: pages,
routes, loaders, actions, islands, and the Vite/SSG build
pipeline (dev/build/start/preview) that ships Framework Mode applications.

The Route Mode subpaths (`@openelement/router/router`,
`@openelement/router/router/client`, `@openelement/router/http`) and the
request-context root export are host-free at runtime: Route Mode pulls no
Vite, Nitro, Element, or Node host dependencies into its module graph.

Framework Mode authoring — the package root (`definePage`,
`defineIslandConfig`, the action protocol) and the Element route-data types it
re-exports — is built on compiled element classes (ADR-0143) and therefore
requires `@openelement/element` to be installed. Element is declared as an
optional peer so a Route Mode install stays lean; install it explicitly when
you import from the package root or use Framework Mode. The declarations are
checked against that contract by a strict, isolated npm consumer
(`tools/release/consumer-packaged-router.ts`).

Host tooling lives behind explicit subpath exports (`./vite`, `./cli/build`,
`./cli/start`) whose dependencies are optional peers. The `./nitro-mount`
deployment subpath instead expects the deploying application to install
`nitro` itself: declaring it as a peer would make npm auto-place
`nitro@3.0.0`, whose own `vite@^7` peer conflicts with the tooling's
`vite@^8` requirement and breaks a bare `npm install`.

> The 1.0 baseline uses compiled element classes for page authoring
> (ADR-0143). Route Mode stays independently consumable without Element;
> Framework Mode installs Element alongside Router.

Use the package root in route, island, and component modules. A route module
default-exports the compiled page class wrapped in `definePage()`:

```tsx
// app/components/page-home.tsx — compiled by the open:compiled-element transform
import { element, OpenElement, property } from '@openelement/element';

@element('home-page', { root: 'shadow-open' })
export default class HomePage extends OpenElement {
  @property({ reflect: false, attribute: false })
  heading = '';

  render() {
    return (
      <main>
        <h1>{this.heading}</h1>
      </main>
    );
  }
}
```

```ts
// app/routes/index.tsx — the route module the scanner discovers
import { definePage } from '@openelement/router';
import HomePage from '../components/page-home.tsx';

export async function loader() {
  return { heading: 'Hello openElement' };
}

export default definePage(HomePage, {
  head: { title: 'Home' },
});
```

Use the Vite facade from `@openelement/router/vite` in `vite.config.ts`:

```ts
import { openElement } from '@openelement/router/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    openElement({
      routesDir: 'app/routes',
      islandsDir: 'app/islands',
      packageIslands: ['@acme/components'],
    }),
  ],
});
```

`openElement()` scans routes and islands, generates virtual entries, builds
client island chunks, runs SSG, and writes post-processed HTML. For a leaner
setup, use `openPipeline()` from the same subpath.

A Vite-mode consumer installs the host packages the tooling peers on:

- `vite` (required by the facade and both CLI subpaths), and
- `@hono/vite-dev-server` (optional peer; required only by the dev server —
  it is loaded lazily, so `build`/`start` never resolve it, and dev mode
  fails closed with an install hint when it is missing).

Deno consumers declare both as `npm:` imports (the generated starter does
this); npm consumers install them as dev dependencies.

## Lifecycle CLI

Generated applications build and serve through the Router CLI subpaths:

```bash
deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys --allow-ffi --no-prompt npm:@openelement/router/cli/build   # production build (SSG + client)
deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys --allow-ffi --no-prompt npm:@openelement/router/cli/start   # serve built output
```

In a generated project the same commands are the scoped `deno task build`
and `deno task start` tasks (the Vite native binding needs `--allow-ffi`;
browser/consumer harnesses instead run `--deny-ffi --no-prompt`).

The build executes in a fixed phase order — SSG (Phase 3) runs before the client
bundle (Phase 2), because client chunk hashes do not affect HTML content and
script injection is a post-processing step:

```text
Phase 1: route, API, middleware, and island scan
Phase 3: SSR bundle, Hono toSSG(), HTML post-processing
Phase 2: client island entry and browser chunks
```

## Nitro deploy mount

Nitro is the first-party production deployment target proven by the Node and
Workers fixtures. Import the mount from the explicit subpath:

```ts
import { createOpenElementNitroHandler } from '@openelement/router/nitro-mount';
```

## Authoring API

```tsx
import { defineIslandConfig, definePage } from '@openelement/router';
```

- `definePage(CompiledPageClass, { route?, head?, renderIntent?, props?, error? })`
  attaches the page descriptor to a compiled page element class. The class
  owns the render program; the descriptor carries metadata plus the optional
  `props`/`error` projectors (pure context → props mappings) — there is no
  render function field and no render-scope data hooks.
- `defineIslandConfig({ ssr, dsd, hydrate })` defines static island metadata
  for adapter scanning; the island itself is a single-module compiled
  `@element` class.
- `fail(status, data)` / `redirect(location)` / `notFound(message)` implement
  the ADR-0120 action protocol; `isActionFailure()` is the duck-typed guard.

Route matching preserves declaration
order while compiling static segments into a trie; named parameters, optional
parameters, and wildcards remain supported.

## Route execution contexts

Server route modules use `LoaderContext<Env, Platform>` and
`ActionContext<Env, Platform>`. Both derive from `ServerRouteContext` and
receive `request`, `params`, `env`, `platform`, `responseHeaders`, and `route`;
actions additionally receive `formData`. `Env` accepts concrete Worker binding
interfaces, including Queue, KV, Service Binding, and Rate Limit objects. Write
response metadata only through `responseHeaders`, which the generated server
merges into its final `Response`.

`OpenElement` remains the runtime primitive in `@openelement/element`, but application
authors should start from this package.

Build configuration is owned by this package's tooling subpaths; generated
projects import the `openElement()` facade from `@openelement/router/vite` and
run builds through `@openelement/router/cli/build`, so the runtime import
surface stays free of host dependencies.

## Install

```bash
npm install @openelement/router
```

Route Mode only uses these subpaths and needs nothing else. Framework Mode
(the package root) also needs Element:

```bash
npm install @openelement/router @openelement/element
```

## License

MIT
