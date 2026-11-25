<p align="center">
  <img src="./www/public/assets/open-avatar.svg" alt="OpenElement logo" width="132" height="132" />
</p>

# OpenElement

<p align="center">
  <a href="https://www.bestpractices.dev/projects/16052"><img src="https://www.bestpractices.dev/projects/16052/badge" alt="OpenSSF Best Practices: passing" /></a>
  <img src="https://img.shields.io/npm/v/%40openelement%2Frouter" alt="npm version" />
  <img src="https://badgen.net/npm/dm/%40openelement%2Felement" alt="npm monthly downloads" />
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="license: MIT" />
  <img src="https://img.shields.io/badge/node-%3E%3D24.2-informational" alt="node: >=24.2" />
</p>

English | [简体中文](./README.zh.md)

OpenElement is a Web Platform-first framework built around **Element** and **Router**.
Element compiles TSX for server-rendered HTML and interactive Custom Elements. Router owns route selection, HTTP semantics, navigation, loaders, and actions.

The npm `latest` line is **`1.0.0-alpha.15`**, with class-based Custom Element authoring.
This checkout previews `1.0.0-alpha.16` with server function pages and compiler-generated Custom Elements. The preview uses packages built from this checkout. [Release state](./docs/release/release-state.json) · [Product model](./docs/architecture/product-model.md)

## Evidence & recognition

These references are reproducible and verifiable by third parties.

- [Software Heritage](https://archive.softwareheritage.org/browse/origin/directory/?origin_url=https://github.com/open-element/openelement)
- [js-framework-benchmark](https://krausest.github.io/js-framework-benchmark/) — external benchmark results (check the entry for its measured version)
- [deps.dev package view](https://deps.dev/npm/%40openelement%2Frouter) and npm provenance attestations on [npm](https://www.npmjs.com/package/@openelement/router)
- Bundle size via [Bundlephobia](https://bundlephobia.com/package/@openelement/element)

## Quick Start from npm

Use **Node.js 24.2+ (24.18.0 recommended)**. The scaffolder installs dependencies with npm when invoked as shown. Open the URL printed by `npm run dev`. Stop the server with Ctrl+C before running the build.

```bash
npm create @openelement my-app
cd my-app
npm run dev
npm run build
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

Open `/hello` in the dev server. `npm run build` writes the prerendered pages and the request-time server to `dist/`. [Alpha 15 getting-started guide](https://github.com/open-element/openelement/blob/v1.0.0-alpha.15/www/content/docs/guide/getting-started.md)

## Preview the current source

From the repository root, use the packed-starter setup to build and install the preview packages into a disposable app.

```sh
pnpm install --frozen-lockfile
export STARTER_SMOKE_WORK_DIR="$(mktemp -d)"
pnpm exec vp run --no-cache --fail-if-no-match --filter @openelement/e2e-starter-smoke setup
cd "$STARTER_SMOKE_WORK_DIR/my-blog"
pnpm run dev
```

Add `app/routes/hello.tsx` to the preview app, then open `/hello`.

```tsx
import { definePage } from '@openelement/router';

export function HelloPage() {
  return <h1>Hello from OpenElement</h1>;
}

export default definePage(HelloPage, {
  head: { title: 'Hello' },
});
```

After stopping the dev server, use `pnpm test` and `pnpm run build` to verify the preview app. [Starter package guide](./packages/create/README.md)

## Features

- Declarative Shadow DOM plus SSR, existing-DOM hydration, and islands that hydrate only where needed.
- Build-time TSX compilation for server function pages and compiler-generated Custom Elements in the source preview.
- Route Mode for explicit route records and Framework Mode for file routes, loaders, actions, and forms.
- A native renderer built around standard Custom Elements and the Web platform.
- Separate server and browser entry graphs keep server-only modules out of client bundles.

## Repository shape

- `packages/protocol` — the cross-system contract package (#1557): Part Program IR, error dialect,
  admission descriptors; zero dependencies, contracts only.
- `packages/element` — the Element core product: the pure runtime; depends only on protocol plus
  `@preact/signals-core` at publish time.
- `packages/compiler` — the Element compiler (#1557): TSX analysis, code generation, and the
  Vite plugin boundary; TypeScript lives here within the Element three-package split,
  while Router tooling also depends on TypeScript.
- `packages/router` — the Router core product: Route Mode and Framework Mode plus the application
  lifecycle tooling (`@openelement/router/vite`, `/nitro-mount`, `/cli/*`).
- `packages/create` — the supported creation entry for the two core products.
- `packages/ui` — experimental UI product, maintained in this repository outside the 1.0 stable promise.
- `www` — the official product surface (documentation site).
- `apps/saas` — an independent first-party consumer application, maintained in this repository but separately governed; it is not part of the framework core or the Alpha repository candidate.

Element and Router are the public framework core. UI is an experimental product; Site is the official product surface; SaaS is an independent first-party application governed separately and is not part of the Alpha repository candidate. None extends the Element/Router stable API promise, and all are owned and maintained by this repository. Historical snapshots remain available through Git tags.

## Development

The source repository is a pnpm workspace on Node (`.node-version` pins the
development line, 24.18); published npm artifacts are qualified separately in
disposable npm consumers.

```sh
pnpm install
pnpm run fmt:check
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run build
```

## Documentation

- [Current architecture (in force)](./docs/architecture/README.md)
- [Active decisions](./docs/adr/README.md)
- [Archive and removal register](./docs/legacy/README.md)
- [Security policy](./SECURITY.md)
- [Contributing](./CONTRIBUTING.md)

OpenElement is available under the MIT license.
