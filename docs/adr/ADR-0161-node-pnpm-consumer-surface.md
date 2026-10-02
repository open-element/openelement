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
  remains `deno run -A npm:@openelement/create@alpha <name>` — Deno resolves
  the published packages through `npm:` specifiers from the same registry
  artifacts. No JSR identifier is published or supported.
- **Runtime floors are stated per verified fact.** Node.js 24+ is the consumer
  floor: it is what the packed package engines declare and what CI exercises
  (including the packed-consumer serve matrix). The repository development
  line is pinned by `.node-version` (24.18). Deno 2.9 remains the floor for
  the one documented Deno-surface command — the create bootstrap — and for
  the in-repo Deno-hosted release/qualify tooling, not for consumers.
- **Documentation states the Node line.** READMEs, guides, and starter
  surfaces describe the Node/pnpm lifecycle; Deno appears only where a Deno
  invocation is the fact (the bootstrap command, release-lane tooling).

## Consequences

The import-map era of starter configuration is closed: `@openelement/*`
subpaths (`/jsx-runtime`, `/vite`, `/nitro-mount`, …) resolve through the
published packages' own exports maps, and the framework no longer asks
consumers to install a second JS runtime. Consumers that want Deno keep
working through the npm artifacts and the documented bootstrap. The remaining
Deno-hosted surface (release tooling, qualify harnesses) is internal and
tracked by the portable-host migration (#1387), not a consumer contract.
