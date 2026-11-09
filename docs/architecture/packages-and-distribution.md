---
status: active
topic: Packages and distribution
summary: The six public packages for two core products, their boundaries and the distribution contract.
---

# Packages and distribution

The repository publishes six public packages for two core products:

- `@openelement/protocol` — shared contract types both products build on.
- `@openelement/element` — Element.
- `@openelement/compiler` — the Element compiler (semantic core plus Vite integration).
- `@openelement/router` — Router Route Mode, Framework Mode, and the application lifecycle
  tooling. The programmatic entry points are subpath exports: Vite orchestration under
  `./vite`, the Nitro mount under `./nitro-mount`, and exactly two CLI subpaths,
  `./cli/build` and `./cli/start`. The lifecycle commands are not exports — they are
  subcommands of the package's bin, which npm installs under two names (`openelement` and
  the short `oe`), and they are `dev`, `build` and `start`; `preview` is not a fourth
  command, it is `start --mode=preview` (static-only serve, which refuses a build carrying
  a request-time server). `dev` is deliberately bin-only: no application imports a dev
  server, so it has no subpath.
  A Route Mode **install** is the published manifest, not the workspace one. The tarball's
  `dependencies` are `@openelement/protocol`, `@openelement/compiler`,
  `@openelement/url-pattern-list`, `mime`, `pathe`, `postcss`, `postcss-value-parser` and
  the pinned `typescript`; the host tooling — `vite`, `@openelement/element`, `hono`,
  `@hono/vite-dev-server`, `marked`, `@tailwindcss/vite` and `unocss` — is declared as
  **optional peers**, which npm never auto-installs, so a Route Mode install pulls no
  Vite, Element, or Nitro host tooling. The pack step is what performs that split: it
  moves `@openelement/element` out of `dependencies` into the optional-peer set and strips
  every optional peer from `dependencies`
  (`tools/release/publish-npm.ts`), which is why the workspace manifest still lists
  Element and Vite as dependencies while the published artifact does not.
  `nitro` is deliberately not declared even as an optional peer: applications that deploy
  through `./nitro-mount` install `nitro` themselves (pinned line:
  `tools/release/nitro-compatibility.ts`, Vite 8 compatible).
- `@openelement/create` — thin consumer scaffolding.
- `@openelement/ui` — experimental UI primitives, maintained in this repository outside the
  1.0 stable promise.

The source repository is a pnpm workspace: one root `package.json` is the workspace authority, `pnpm-workspace.yaml` declares membership, and a single `pnpm-lock.yaml` pins the dependency graph. Development, testing, and building run on Node with pnpm — `.node-version` pins the development line, the packed packages declare `node >=24.2`, scripts are driven through pnpm and the `vp` task entry (`vp run --no-cache --fail-if-no-match --filter <pkg> <task>`), and tests run on vitest. (The repository was Deno-native with no root npm workspace authority before the alpha8 Node/pnpm conversion; ADR-0161 records that history.) Published npm tarballs must install in disposable projects outside the monorepo, resolve standard exports and declarations, and remain free of workspace aliases, private source paths, and unintended server/browser dependency leakage.

TypeScript is layered deliberately. The workspace typechecks through the classic `tsc` CLI (`typecheck` scripts run `tsc --noEmit`, TypeScript pinned at 6.0.3 across the workspace), and the Element compiler and every other AST consumer use the classic TypeScript compiler API from that same pinned dependency, imported directly. The TypeScript 7 `tsc` CLI remains an explicit shadow qualification (`tools/repo#gate:ts7:shadow`) over the packed Node/npm consumer matrix; it is not part of every pull-request run while the disposable consumer's TS7 result is compared with the packed Element dependency's pinned TS6 baseline. It becomes a required gate only after a complete matching matrix. (In the retired Deno toolchain the split ran through Deno's own checker and an import-map `typescript` name; that mapping is retired with the toolchain.)

The six packages publish on one version line — the package graph refuses mixed
versions — while release tooling may publish a selected subset of that line
(`publish:npm --packages`). "Per-package" therefore means selection inside the
shared version line, never independent SemVer, and package count does not
change the two-product model. From the 1.0 line onward the prerelease is the
shipping line: it publishes onto npm `latest`, and the `alpha` channel tag is
kept as a re-pointed alias (the internal release procedure, not published —
"Public 1.0 prerelease baseline"). Pre-1.0 candidates use `alpha` only and never move
`latest` onto a prerelease.
