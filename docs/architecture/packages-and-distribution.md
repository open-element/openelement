# Packages and distribution

The repository publishes four public packages for two core products:

- `@openelement/element` — Element.
- `@openelement/router` — Router Route Mode, Framework Mode, and the application lifecycle
  tooling (Vite orchestration under `./vite`, Nitro mount under `./nitro-mount`, and the
  `dev`/`build`/`start`/`preview` CLI under `./cli/*`). Host-tooling dependencies are optional
  peers, so a Route Mode install pulls no Vite, Nitro, Element, or Node host dependencies.
  `nitro` is deliberately not declared even as an optional peer: npm auto-places optional
  peers when they resolve — applications that deploy through `./nitro-mount` install
  `nitro` themselves (pinned line: `tools/release/nitro-compatibility.ts`, Vite 8 compatible).
- `@openelement/create` — thin consumer scaffolding.
- `@openelement/ui` — experimental UI primitives, maintained in this repository outside the
  1.0 stable promise.

The source repository is a pnpm workspace: one root `package.json` is the workspace authority, `pnpm-workspace.yaml` declares membership, and a single `pnpm-lock.yaml` pins the dependency graph. Development, testing, and building run on Node with pnpm — `.node-version` pins the development line, the packed packages declare `node >=24.2`, scripts are driven through pnpm and the `vp` task entry (`vp run <pkg>#<task>`), and tests run on vitest. (The repository was Deno-native with no root npm workspace authority before the alpha8 Node/pnpm conversion; ADR-0161 records that history.) Published npm tarballs must install in disposable projects outside the monorepo, resolve standard exports and declarations, and remain free of workspace aliases, private source paths, and unintended server/browser dependency leakage.

TypeScript is layered deliberately. The workspace typechecks through the classic `tsc` CLI (`typecheck` scripts run `tsc --noEmit`, TypeScript pinned at 6.0.3 across the workspace), and the Element compiler and every other AST consumer use the classic TypeScript compiler API from that same pinned dependency, imported directly. The TypeScript 7 `tsc` CLI remains an explicit shadow qualification (`tools/repo#gate:ts7:shadow`) over the packed Node/npm consumer matrix; it is not part of every pull-request run while the disposable consumer's TS7 result is compared with the packed Element dependency's pinned TS6 baseline. It becomes a required gate only after a complete matching matrix. (In the retired Deno toolchain the split ran through Deno's own checker and an import-map `typescript` name; that mapping is retired with the toolchain.)

Supporting packages may release in lockstep while required by tooling, but package count does not change the two-product model. npm alpha candidates use `alpha`; `latest` remains stable until a separately admitted stable release.
