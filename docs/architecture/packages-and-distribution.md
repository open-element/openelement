# Packages and distribution

The repository publishes three physical support-distribution packages for two products:

- `@openelement/element` — Element.
- `@openelement/router` — Router Route Mode, Framework Mode, and the application lifecycle
  tooling (Vite orchestration under `./vite`, Nitro mount under `./nitro-mount`, and the
  `dev`/`build`/`start`/`preview` CLI under `./cli/*`). Host-tooling dependencies are optional
  peers, so a Route Mode install pulls no Vite, Nitro, Element, or Node host dependencies.
  `nitro` is deliberately not declared even as an optional peer: npm auto-places optional
  peers when they resolve, and `nitro@3.0.0`'s own `vite@^7` peer would conflict with the
  tooling's `vite@^8` floor — applications that deploy through `./nitro-mount` install
  `nitro` themselves.
- `@openelement/create` — thin consumer scaffolding.

The source repository is Deno-native and has no root npm workspace authority. Published npm tarballs must install in disposable projects outside the monorepo, resolve standard exports and declarations, and remain free of workspace aliases, private source paths, and unintended server/browser dependency leakage.

Supporting packages may release in lockstep while required by tooling, but package count does not change the two-product model. npm alpha candidates use `alpha`; `latest` remains stable until a separately admitted stable release.
