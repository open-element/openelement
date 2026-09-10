# @openelement/app

Application authoring API for openElement: pages, routes, loaders, actions,
islands and the SPA bootstrap.

> The 1.0 baseline uses compiled element classes for page authoring
> (ADR-0143) while Router remains independently consumable.

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
import { definePage } from '@openelement/app';
import HomePage from '../components/page-home.tsx';

export async function loader() {
  return { heading: 'Hello openElement' };
}

export default definePage(HomePage, {
  head: { title: 'Home' },
});
```

Use the Vite facade from `@openelement/adapter-vite` in `vite.config.ts`:

```ts
import { openElement } from '@openelement/adapter-vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    openElement({
      routesDir: 'app/routes',
      islandsDir: 'app/islands',
      packageIslands: ['@acme/components'],
      content: { blog: { contentDir: 'content/blog' } },
      i18n: { locales: ['en', 'zh'], defaultLocale: 'en' },
    }),
  ],
});
```

## Authoring API

```tsx
import { defineIslandConfig, definePage } from '@openelement/app';
```

- `definePage(CompiledPageClass, { route?, head?, renderIntent?, props?, error? })`
  attaches the page descriptor to a compiled page element class. The class
  owns the render program; the descriptor carries metadata plus the optional
  `props`/`error` projectors (pure context → props mappings) — there is no
  render function field and no render-scope data hooks.
- `defineIslandConfig({ ssr, dsd, hydrate })` defines static island metadata
  for adapter scanning; the island itself is a single-module compiled
  `@element` class.
- `defineApp({ mode: 'spa', routes })` bootstraps the client-only SPA chain
  (`@openelement/app/spa`); each route is `{ path, tagName, loader?, action?, guard? }`.
- `fail(status, data)` / `redirect(location)` / `notFound(message)` implement
  the ADR-0120 action protocol; `isActionFailure()` is the duck-typed guard.

SPA action failures expose `{ error: 'Action failed' }` to page renderers. Raw
exceptions are logged only in development. Route matching preserves declaration
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

SPA handlers are a separate browser execution chain. Use `SpaLoaderContext`
and `SpaActionContext`; they intentionally expose only route params (and SPA
action form data). A server loader cannot be reused unchanged in SPA mode,
because browsers do not receive server `Request`, environment, platform,
response-header, or route-metadata capabilities.

`OpenElement` remains the runtime primitive in `@openelement/element`, but application
authors should start from this package.

Build configuration is owned by `@openelement/adapter-vite`; generated projects
and docs import its `openElement()` facade from the package root rather than an
app-package Vite subpath.

## Install

```bash
npm install @openelement/app
```

## License

MIT
