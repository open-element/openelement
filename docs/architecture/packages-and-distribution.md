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
  A Route Mode **install** is the published manifest, not the workspace one. The
  authoritative source for what a tarball installs is the pack split in
  `tools/release/publish-npm.ts` together with each package's own `package.json`;
  this document deliberately does not enumerate `dependencies` or the optional-peer
  set — a hand-copied manifest with no generator and no drift guard rots the moment
  the pack split moves. The conclusion that matters here: host tooling rides as
  optional peers that npm never auto-installs, so a Route Mode install pulls no
  Vite, Element, or Nitro host toolchain.
  `nitro` is deliberately not declared even as an optional peer: applications that deploy
  through `./nitro-mount` install `nitro` themselves (pinned line:
  `tools/release/nitro-compatibility.ts`, Vite 8 compatible).
- `@openelement/create` — thin consumer scaffolding.
- `@openelement/ui` — experimental UI primitives, maintained in this repository outside the
  1.0 stable promise.

The source repository is a pnpm workspace: one root `package.json` is the workspace authority, `pnpm-workspace.yaml` declares membership, and a single `pnpm-lock.yaml` pins the dependency graph. Development, testing, and building run on Node with pnpm — `.node-version` pins the development line, the packed packages declare `node >=24.2`, scripts are driven through pnpm and the `vp` task entry (`vp run --no-cache --fail-if-no-match --filter <pkg> <task>`), and tests run on vitest. Published npm tarballs must install in disposable projects outside the monorepo, resolve standard exports and declarations, and remain free of workspace aliases, private source paths, and unintended server/browser dependency leakage.

TypeScript is layered deliberately. The workspace typechecks through the classic `tsc` CLI (`typecheck` scripts run `tsc --noEmit`, TypeScript pinned at 6.0.3 across the workspace), and the Element compiler and every other AST consumer use the classic TypeScript compiler API from that same pinned dependency, imported directly. The TypeScript 7 `tsc` CLI remains an explicit shadow qualification (`tools/repo#gate:ts7:shadow`) over the packed Node/npm consumer matrix; it is not part of every pull-request run while the disposable consumer's TS7 result is compared with the packed Element dependency's pinned TS6 baseline. It becomes a required gate only after a complete matching matrix.

The six packages publish on one version line — the package graph refuses mixed
versions — while release tooling may publish a selected subset of that line
(`publish:npm --packages`). "Per-package" therefore means selection inside the
shared version line, never independent SemVer, and package count does not
change the two-product model. From the 1.0 line onward the prerelease is the
shipping line: it publishes onto npm `latest`, and the `alpha` channel tag is
kept as a re-pointed alias (the internal release procedure, not published —
"Public 1.0 prerelease baseline"). Pre-1.0 candidates use `alpha` only and never move
`latest` onto a prerelease.

## Generated component manifests

A UI module under `packages/ui/src/open-<name>.tsx` is published through its
matching `./open-<name>` subpath. The manifest generator uses that export to
supply the compiler with an explicit generated custom-element site. It rejects
unadmitted component modules before emitting metadata. The generated package
manifest and standard Custom Elements Manifest have separate reproducibility
checks. [Retained platform concerns](./alpha16-18-execution-plan.md#retained-platform-concerns)
