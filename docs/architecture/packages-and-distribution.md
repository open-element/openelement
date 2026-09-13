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

TypeScript is layered deliberately. Deno source is checked by Deno's own supported checker; the Element compiler and every other AST consumer use the classic TypeScript compiler API, reached through the import-map name `typescript`, which maps directly to the exact `npm:typescript@6.0.3`. The TypeScript 7 `tsc` CLI is exercised only as an independent shadow gate (`deno task gate:ts7:shadow`, non-blocking CI job `ts7-shadow`) over the packed Node/npm consumer matrix; the disposable consumer root owns TS7 while the packed Element dependency retains its own pinned TS6 baseline. It becomes a required gate only after a complete matching matrix.

Supporting packages may release in lockstep while required by tooling, but package count does not change the two-product model. npm alpha candidates use `alpha`; `latest` remains stable until a separately admitted stable release.
