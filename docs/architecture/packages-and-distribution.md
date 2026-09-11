# Packages and distribution

The repository currently publishes four physical support-distribution packages for two products:

- `@openelement/element` — Element.
- `@openelement/router` — Router Route Mode and Framework Mode.
- `@openelement/adapter-vite` — thin Router build integration (the Element compiler and Vite
  transform live in `@openelement/element` under the `./compiler` and `./vite` tooling subpaths).
- `@openelement/create` — thin consumer scaffolding.

The source repository is Deno-native and has no root npm workspace authority. Published npm tarballs must install in disposable projects outside the monorepo, resolve standard exports and declarations, and remain free of workspace aliases, private source paths, and unintended server/browser dependency leakage.

Supporting packages may release in lockstep while required by tooling, but package count does not change the two-product model. npm alpha candidates use `alpha`; `latest` remains stable until a separately admitted stable release.
