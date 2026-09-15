# OpenElement

English | [简体中文](./README.zh.md)

OpenElement is a Web Platform-first core for two products: **Element** and **Router**.
Element compiles JSX-authored Custom Elements into a Part Program used by server serialization, fresh DOM, and existing-DOM claim. Router owns route selection, HTTP semantics, navigation, loaders, actions, and the shared Native/Lit Framework Mode application contract.

The source tree is `1.0.0-alpha.1`, a new public baseline for Element and Router. It is not a compatibility migration from historic 0.x snapshots. npm `latest` is per package: element, create, and ui remain on the 0.43 stable line, while Router's `latest` is the 0.41.0-alpha.6 prerelease. No single version is published for all four packages until a separately admitted release.

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
