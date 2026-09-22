# OpenElement

English | [简体中文](./README.zh.md)

OpenElement is a Web Platform-first core for two products: **Element** and **Router**.
Element compiles JSX-authored Custom Elements into a Part Program used by server serialization, fresh DOM, and existing-DOM claim. Router owns route selection, HTTP semantics, navigation, loaders, actions, and the shared Native/Lit Framework Mode application contract.

The source tree is `1.0.0-alpha.3`, a new public baseline for Element and Router. It is not a compatibility migration from historic 0.x snapshots. npm `latest` is per package: element, create, and ui remain on the 0.43 stable line, while Router's `latest` is the 0.41.0-alpha.6 prerelease. No single version is published for all four packages until a separately admitted release.

## Quick Start

Requires **Deno 2.9+**. Create, run, and build:

```bash
deno run -A npm:@openelement/create@alpha my-app
cd my-app
deno task dev
deno task build
```

Add a page — one compiled element plus one route record:

```tsx
// app/components/page-hello.tsx
import { element, OpenElement } from '@openelement/element';

@element('hello-page', { root: 'shadow-open' })
export default class HelloPage extends OpenElement {
  render() {
    return (
      <main>
        <h1>Hello from OpenElement</h1>
      </main>
    );
  }
}
```

```tsx
// app/routes/hello.tsx
import { definePage } from '@openelement/router';
import HelloPage from '../components/page-hello.tsx';

export default definePage(HelloPage, {
  head: { title: 'Hello' },
});
```

Re-run `deno task dev`, open the URL Vite prints plus `/hello`, and `deno task build` emits the static-first `dist/` output. Full walkthrough: <https://openelement.org/guide/getting-started>.

**Build-time host note:** the `@openelement/router` tooling subpaths (`./vite`, `./cli/*`) call Deno APIs directly and require a Deno host at **build time** — invoking them from a plain Node `vite.config.ts` fails with `Deno is not defined`. The request-time output stays WinterCG-pure and deploys to any target. This is an interim constraint: the portable-host tooling migration that removes it is a deferred roadmap item ([#1387](https://github.com/open-element/openelement/issues/1387)).

## Features

- Declarative Shadow DOM plus SSR, existing-DOM claim, and islands that hydrate only where needed.
- Authoring JSX is compiled to a Part Program at build time; there is no runtime virtual-DOM contract.
- Route Mode for explicit route records and Framework Mode for file routes, loaders, actions, and forms.
- Native and Lit renderers behind one application contract; renderer integrations stay explicit.
- Compiled output tree-shakes so server-only modules never leak into the client bundle.

## Comparison

| Framework | Difference from OpenElement                                                                                                                                                                                                                                                                                                                                                                     |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Astro     | Island architecture for content sites with framework-agnostic components; OpenElement compiles its own Custom Elements and owns routing and SSR/SSG in the same repository.                                                                                                                                                                                                                     |
| Fresh     | Deno-native Preact islands framework whose development has stalled: last code commit 2026-05-27, last release 2.3.3 (2026-04-28), 157 open issues unaddressed (verified as of 2026-09-20). That leaves the Deno-native islands slot open, and OpenElement is positioned to occupy it — compiled Custom Elements (Native/Lit renderers), static-first output, and routing/SSR in one repository. |
| Lit       | A Web Component rendering library, not an application framework; OpenElement can render through Lit as one renderer option rather than replacing it.                                                                                                                                                                                                                                            |
| Next.js   | A React-centered full-stack framework; OpenElement covers the static-first Element/Router core and leaves full-stack parity out of scope.                                                                                                                                                                                                                                                       |

## Quick Start

Requires **Deno 2.9+**. Create, run, and build:

```bash
deno run --allow-read --allow-write --allow-env --allow-net --deny-ffi --no-prompt --minimum-dependency-age 0 npm:@openelement/create@alpha my-app
cd my-app
deno task dev
deno task build
```

Add a page — one compiled element plus one route record:

```tsx
// app/components/page-hello.tsx
import { element, OpenElement } from '@openelement/element';

@element('hello-page', { root: 'shadow-open' })
export default class HelloPage extends OpenElement {
  render() {
    return (
      <main>
        <h1>Hello from OpenElement</h1>
      </main>
    );
  }
}
```

```tsx
// app/routes/hello.tsx
import { definePage } from '@openelement/router';
import HelloPage from '../components/page-hello.tsx';

export default definePage(HelloPage, {
  head: { title: 'Hello' },
});
```

Re-run `deno task dev`, open the URL Vite prints plus `/hello`, and `deno task build` emits the static-first `dist/` output. Full walkthrough: <https://openelement.org/guide/getting-started>.

**Build-time host note:** the `@openelement/router` tooling subpaths (`./vite`, `./cli/*`) call Deno APIs directly and require a Deno host at **build time** — invoking them from a plain Node `vite.config.ts` fails with `Deno is not defined`. The request-time output stays WinterCG-pure and deploys to any target. This is an interim constraint: the portable-host tooling migration that removes it is a deferred roadmap item ([#1387](https://github.com/open-element/openelement/issues/1387)).

## Features

- Declarative Shadow DOM plus SSR, existing-DOM claim, and islands that hydrate only where needed.
- Authoring JSX is compiled to a Part Program at build time; there is no runtime virtual-DOM contract.
- Route Mode for explicit route records and Framework Mode for file routes, loaders, actions, and forms.
- Native and Lit renderers behind one application contract; renderer integrations stay explicit.
- Compiled output tree-shakes so server-only modules never leak into the client bundle.

## Comparison

| Framework | Difference from OpenElement                                                                                                                                                                                                                                                                                                                                                                     |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Astro     | Island architecture for content sites with framework-agnostic components; OpenElement compiles its own Custom Elements and owns routing and SSR/SSG in the same repository.                                                                                                                                                                                                                     |
| Fresh     | Deno-native Preact islands framework whose development has stalled: last code commit 2026-05-27, last release 2.3.3 (2026-04-28), 157 open issues unaddressed (verified as of 2026-09-20). That leaves the Deno-native islands slot open, and OpenElement is positioned to occupy it — compiled Custom Elements (Native/Lit renderers), static-first output, and routing/SSR in one repository. |
| Lit       | A Web Component rendering library, not an application framework; OpenElement can render through Lit as one renderer option rather than replacing it.                                                                                                                                                                                                                                            |
| Next.js   | A React-centered full-stack framework; OpenElement covers the static-first Element/Router core and leaves full-stack parity out of scope.                                                                                                                                                                                                                                                       |

## Repository shape

- `packages/element` — the Element core product.
- `packages/router` — the Router core product: Route Mode and Framework Mode plus the application
  lifecycle tooling (`@openelement/router/vite`, `/nitro-mount`, `/cli/*`).
- `packages/create` — the supported creation entry for the two core products.
- `packages/ui` — experimental UI product, maintained in this repository outside the 1.0 stable promise.
- `www` — the official product surface (documentation site).
- `apps/saas` — an independent first-party consumer application, maintained in this repository but separately governed; it is not part of the framework core or the Alpha repository candidate.

Element and Router are the public framework core. UI is an experimental product; Site is the official product surface; SaaS is an independent first-party application governed separately and is not part of the Alpha repository candidate. None extends the Element/Router stable API promise, and all are owned and maintained by this repository. Historical snapshots remain available through Git tags.

## Development

The source repository is Deno-native; published npm artifacts are qualified separately in disposable npm consumers.

```sh
deno install
deno task fmt:check
deno task lint
deno task typecheck
deno task test
deno task build
```

## Documentation

- [Current architecture](./docs/architecture/README.md)
- [Active decisions](./docs/adr/README.md)
- [Release operation](./docs/maintainers/releasing.md)
- [Security policy](./SECURITY.md)
- [Contributing](./CONTRIBUTING.md)

OpenElement is available under the MIT license.
