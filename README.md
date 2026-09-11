# OpenElement

English | [简体中文](./README.zh.md)

OpenElement is a Web Platform-first core for two products: **Element** and **Router**.
Element compiles JSX-authored Custom Elements into a Part Program used by server serialization, fresh DOM, and existing-DOM claim. Router owns route selection, HTTP semantics, navigation, loaders, actions, and the shared Native/Lit Framework Mode application contract.

The source tree is `1.0.0-alpha.1`, a new public baseline for Element and Router. It is not a compatibility migration from historic 0.x snapshots. npm `latest` remains on the stable 0.43 line until a separately admitted stable release.

## Repository shape

- `packages/element` — the Element product.
- `packages/router` — Router Route Mode and Framework Mode implementation.
- `packages/adapter-vite` — thin Element/Router compiler, Vite, and server-output integration.
- `packages/create` — thin consumer scaffolding for the two products.

UI components, Reader/Mastodon applications, reference SaaS projects, examples, and the documentation site are separate consumers rather than core-repository products. Historical snapshots remain available through Git tags.

## Development

The source repository is Deno-native; published npm artifacts are qualified separately in disposable npm consumers.

```sh
deno task fmt:check
deno task lint
deno task typecheck
deno task test
deno task build
```

## Documentation

- [Current architecture](./docs/architecture/README.md)
- [Active decisions](./docs/adr/README.md)
- [Architecture history](./docs/history/architecture-evolution.md)
- [Release operation](./docs/maintainers/releasing.md)
- [Security policy](./SECURITY.md)
- [Contributing](./CONTRIBUTING.md)

OpenElement is available under the MIT license.
