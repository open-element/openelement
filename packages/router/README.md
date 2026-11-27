# @openelement/router

Docs and guides: <https://openelement.org>.

Application authoring API and lifecycle tooling for openElement: pages,
routes, loaders, actions, islands, and the Vite/SSG build
pipeline (dev/build/start/preview) that ships Framework Mode applications.

The Route Mode subpaths (`@openelement/router/router`,
`@openelement/router/router/client`, `@openelement/router/http`) are host-free
at runtime. Route Mode pulls no
Vite, Nitro, Element, or Node host dependencies into its module graph.

Framework Mode authoring — the package root (`definePage`,
`defineIslandConfig`, the action protocol) and the Element route-data types it
re-exports — depends on the `@openelement/element` runtime. The `./document`
subpath (the resolved-page seam used by the native serializer) is
Framework Mode surface too: it depends on Element's trusted-HTML contract
through the shared head-safety predicates, so it is not part of the
Element-free Route Mode closure. Element is declared as an
optional peer so a Route Mode install stays lean; install it explicitly when
you import from the package root or use Framework Mode. The declarations are
checked against that contract by a strict, isolated npm consumer.

Host tooling lives behind explicit subpath exports (`./vite`, `./cli/build`,
`./cli/start`); Vite is an optional peer, so a Route Mode install does not pull
it. The lifecycle commands are bin subcommands rather than exports: the package
installs one dispatcher under two names — the long `openelement` and the short
`oe` — and it answers `dev`, `build` and `start`, where `preview` is not a
fourth command but `start --mode=preview` (static-only serve). `dev` is
bin-only: no application imports a dev server, so it deliberately has no
subpath. The `./nitro-mount`
deployment subpath instead expects the deploying application to install
`nitro` itself: declaring it as a peer would make npm auto-place
`nitro@3.0.0`, whose own `vite@^7` peer conflicts with the tooling's
`vite@^8` requirement and breaks a bare `npm install`.

The `./vite` and `./cli/*` tooling subpaths run under Node at **build
time** — `openElement()` is invoked from the project's `vite.config.ts` and
the CLI subpaths run through `node`. The request-time output is
WinterCG-pure; deployment support is limited to the runtimes and Nitro
targets actually covered by the release qualification matrix (the Node and
Workers fixtures), not every runtime that can load ESM.

Author pages and islands as JSX or TSX function components. A server function
page exports its component and passes it to `definePage()` in the route
module. Router prerenders this page by default.

```tsx
// app/routes/index.tsx
import { definePage } from '@openelement/router';

export function HomePage() {
  return (
    <main>
      <h1>Hello OpenElement</h1>
    </main>
  );
}

export default definePage(HomePage, { head: { title: 'Home' } });
```

For an interactive island, default-export its function and declare the tag,
root and behavior in an `openElement` sidecar made with `defineIslandConfig`.
An interactive page root can also use a compiled shadow component imported
from outside the route module. See [Routing and data](https://openelement.org/guide/routing-and-data/)
for both page forms.

Use the Vite facade from `@openelement/router/vite` in `vite.config.ts`:

```ts
import { openElement } from '@openelement/router/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [...openElement()],
});
```

`openElement()` scans routes and islands, generates virtual entries, builds
client island chunks, runs SSG, and writes post-processed HTML. Use
`packageIslands` in `openelement.config.ts` to list installed component
packages explicitly. For a leaner setup, use `openPipeline()` from the same
Vite subpath.

A Vite-mode consumer installs the host packages the tooling peers on:

- `vite` (required by the facade and both CLI subpaths), and
- `@hono/vite-dev-server` (optional peer; required only by the dev server —
  it is loaded lazily, so `build`/`start` never resolve it, and dev mode
  fails closed with an install hint when it is missing).

Consumers install them as dev dependencies (the generated starter does this).

The generated server entry itself has no HTTP-framework dependency: it
composes on the internal WinterCG layer (#1560 — the request scope, the
`(request, next) => Response` middleware chain, and the 404/405 method
policy). `hono` is an optional peer: the one adapter,
`@openelement/router/hono` (`createHonoAdapter`), mounts the entry's
WinterCG handler inside a consumer's own Hono app and is the only module
that resolves it.

## Lifecycle CLI

Generated applications build and serve through the `openelement` bin this
package ships (`build` and `start` subcommands), or through the equivalent
tooling subpaths `@openelement/router/cli/build` and
`@openelement/router/cli/start`:

```bash
openelement build          # production build (SSG + client)
openelement start          # serve the verified public directory and request-time routes
openelement publish --check # verify dist-public/ before uploading it
```

The package declares a second bin, the short alias `oe`, pointing at the
same CLI entry — every command and flag answers identically under either
spelling, so `oe build`, `oe start`, and `oe version` behave exactly like
their `openelement` counterparts.

In a generated project the same commands are the package scripts
`pnpm build` and `pnpm start` (plus `pnpm dev` for the Vite dev server; a
static-only serve is `openelement start --mode=preview`, which refuses a
build that has a request-time server).

The build executes in a fixed phase order — the client bundle (Phase 2) runs
before the SSG render (Phase 3), because the SSG pages inject their client
assets from the Phase 2 build manifest (#1471):

```text
Phase 1: route, API, middleware, and island scan
Phase 2: client island entry and browser chunks
Phase 3: SSR bundle, static prerender over the app dispatch, HTML post-processing
```

## Nitro deploy mount

Nitro is the first-party production deployment target; the supported runtimes
and Nitro presets are the ones the release qualification matrix covers (the
Node and Workers fixtures), not every runtime that can load ESM. Import the
mount from the explicit subpath:

```ts
import { createOpenElementNitroHandler } from '@openelement/router/nitro-mount';
```

## Server runtime subpath

The generated server entries import their request-time runtime from
`@openelement/router/server-runtime`: the generated-app factory
(`createGeneratedApp` — the WinterCG app, the request-scope accessor, the
composed handler exports, and the page-render bindings), the built-in
middleware (request-id, logger, CORS, secure headers), the response-header
channel with its commitment gate, the CSP auto-nonce, the page SSR renderer
seam, the action POST protocol, and the streaming pump. The logic lives in typecheckable
modules instead of codegen template strings, so it is directly unit-testable.

Applications never import this subpath directly — the entries the Vite
pipeline generates do. It is exported for type-aware tooling and for hosts
that assemble the same server seams by hand.

## Route Mode subpaths

Route Mode is consumable without Element or a renderer through three
subpaths.

```ts
import { RouteTable } from '@openelement/router/router'; // route records + matching
// Browser navigation entry (compiled matcher + router instance):
import { createRouter } from '@openelement/router/router/client';
// WinterCG fetch middleware for Route Mode, and its method policy:
import { createRouteMiddleware } from '@openelement/router/http';
```

`createRequestContext()` is available from the package root. Install Element
when importing from that entry.

## Authoring API

```tsx
import { defineIslandConfig, definePage } from '@openelement/router';
```

- `definePage(PageComponent, { route?, head?, renderIntent?, props?, error? })`
  attaches the page descriptor to a page component (a default-exported function
  component beside its `defineIslandConfig` sidecar, or a server function page's
  own component). The component owns the render program; the descriptor carries
  metadata plus the optional `props`/`error` projectors (pure context → props
  mappings) — there is no render function field and no render-scope data hooks.
- `defineIslandConfig({ tag, root, properties, ssr, dsd, hydrate })` declares
  the component's element facts for compiler admission and adapter scanning: the
  custom-element tag, its root, the declared property table, and the optional
  island delivery policy.
- `fail(status, data)` / `redirect(location)` / `notFound(message)` implement
  the action protocol; `isActionFailure()` is the duck-typed guard.

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

The runtime primitive is the compiler-emitted Native Custom Element, whose runtime
surface lives in `@openelement/element`; application authors start from this package.

Build configuration is owned by this package's tooling subpaths; generated
projects import the `openElement()` facade from `@openelement/router/vite` and
run builds through the `openelement` bin (or the equivalent
`@openelement/router/cli/build` subpath), so the runtime import
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

Note that the `./vite` and `./cli/*` tooling subpaths are **build-time**
modules — run builds through the Node-hosted `openelement` bin
(`openelement build`) or the Vite CLI.
For qualified request-time deployment targets, see [Nitro deploy mount](#nitro-deploy-mount).

## License

MIT
