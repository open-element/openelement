# ADR-0161: Node/pnpm consumer surface, npm-only distribution

- Status: ACCEPTED
- Supersedes: ADR-0108 (the Deno-native distribution decision; its npm-only
  publishing half stands and is restated here)

## Context

ADR-0108 decided that Deno remains the repository toolchain while packages
publish as ordinary npm artifacts, and accepted that Framework Mode consumers
need Deno 2.9+ installed to develop and build. The alpha8 platform train
removed the premise: the repository itself now develops, tests, and builds on
Node with pnpm (package.json workspaces with a single lock, vitest as the test
runner, the CI gate surface on Node, `.dvmrc` retired in favor of
`.node-version`), and the packed `@openelement/*` artifacts are compiled JS
with declarations that install and run as plain Node packages. A consumer
requirement to install Deno no longer follows from how anything is built, and
the starter shipped by `@openelement/create` still being a Deno project would
make the framework the only reason a Node shop keeps a Deno install.

## Decision

- **npm is the only distribution channel.** This half of ADR-0108 stands:
  packages publish to npm in dependency order with Trusted Publishing and
  provenance; JSR is never a publish channel; packed artifacts keep the
  export-completeness, declarations, pure-ESM, dependency-range, and
  runtime-boundary gates before publication.
- **The supported consumer surface is Node + pnpm.** The generated starter is
  a plain Node project: dependency pins in `package.json` (exact
  `@openelement/*` release pins replace the former Deno import map), lifecycle
  through pnpm scripts, type-checking through a generated `tsconfig.json`. A
  clean Node machine must `install` and `build` a generated project; the
  packed-starter consumer qualifications run dev, check, test, build, start,
  and the three-browser matrix through those scripts.
- **Deno consumers are npm: consumers.** The documented create bootstrap
  remains the scaffold command shown in the README (a plain `deno run` of
  `npm:@openelement/create@alpha <name>`) — Deno resolves
  the published packages through `npm:` specifiers from the same registry
  artifacts. No JSR identifier is published or supported.
- **Runtime floors are stated per verified fact.** Node.js 24.2+ is the
  consumer floor: it is what the packed package engines declare and what CI
  exercises (including the packed-consumer serve matrix). The point floor is
  24.2, not bare 24, because the Router CLI gates on `import.meta.main`,
  which Node added in 24.2.0 — on 24.0/24.1 the guard is undefined and the
  CLI would silently exit 0. The repository development
  line is pinned by `.node-version` (24.18). Node 24.2 is the floor for every
  consumer surface including the create bootstrap (see the 2026-10-03
  amendment); no Deno floor is declared anywhere.
- **Documentation states the Node line.** READMEs, guides, and starter
  surfaces describe the Node/pnpm lifecycle; Deno appears only in historical
  records (this ADR's context and its amendment trail).

## Consequences

The import-map era of starter configuration is closed: `@openelement/*`
subpaths (`/jsx-runtime`, `/vite`, `/nitro-mount`, …) resolve through the
published packages' own exports maps, and the framework no longer asks
consumers to install a second JS runtime. The release tooling and qualify
harnesses that were Deno-hosted at acceptance time are fully Node-hosted as
of the 2026-10-03 amendment; nothing in the repository requires a Deno
install.

## Amendment (2026-10-03, owner ruling)

The "完全去除 deno" ruling retires the last Deno-flavored consumer surface
this ADR documented, and supersedes the bullets above where they conflict:

- **The Deno bootstrap is retired.** The create CLI ships as a Node bin
  (`#!/usr/bin/env node`; npm bins `openelement-create` and
  `create-openelement`, both the packed `src/cli.js` entry). The documented
  bootstrap is a plain Node invocation — canonical
  `npm exec @openelement/create@alpha -- <name>`, with the `npx` short form
  and the pnpm `pnpm dlx --package=@openelement/create@alpha
  openelement-create <name>` variant (the packed package ships two bins, so
  the pnpm form names one explicitly) — verified against the published
  artifact. The 2026-09-21 consumer-scaffold exemption in the broad-permission
  tripwire retires with the command it covered.
- **Deno consumers are no longer a documented or qualification-verified
  support surface.** The npm artifacts happen to be loadable by Deno (plain
  compiled ESM with `npm:`-resolvable dependencies), but that is incidental,
  not a promise: no Deno engine is declared, no Deno leg runs in consumer
  qualification, and no Deno spelling is documented.
- **The release/qualify toolchain is fully Node-hosted.** Packing, publishing,
  and the published/packed consumer qualifications run on Node via pnpm
  scripts; the portable-host migration (#1387) is complete for this surface.
  The engines floor for every retained package is `node >=24.2`.
