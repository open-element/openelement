# @openelement/create

Project scaffolding CLI for openElement applications.

Docs and guides: <https://openelement.org>.

> 1.0 Alpha line: the supported creation entry for Element and Router. The
> published npm versions and dist-tags are registry truth (query them with
> `npm view @openelement/create dist-tags`); `latest` stays on the stable 0.43
> line until a separately admitted stable release.

`@openelement/create` generates a new openElement project with the recommended
directory structure, a pnpm-scripted package manifest, Vite setup, and starter
pages (ADR-0161: the generated project is a plain Node/pnpm project).

## Usage (1.0 Alpha)

```bash
deno run -A npm:@openelement/create@alpha my-app
cd my-app
pnpm install
pnpm dev
```

The version `@alpha` resolves to is registered in
`the tracked release-state manifest` (currently `1.0.0-alpha.7`, a new baseline —
not a 0.x upgrade, with no migration path from 0.x). Pin that exact version
when reproducibility matters (verify against the live registry with
`npm view @openelement/create dist-tags.alpha`):

```bash
deno run -A npm:@openelement/create@1.0.0-alpha.7 my-app
```

`--minimum-dependency-age 0` is needed because Deno's default
minimumDependencyAge (~24h) refuses packages published within the last day.

The generated starter pins the exact `@openelement/*` versions it was built
from in its `package.json` dependencies.

The canonical install command is exported from `@openelement/create/install-command` (one builder, every documented copy derives from it).

## The bootstrap is a Deno invocation; the generated project is Node

The documented bootstrap runs the generator through `deno run … npm:…` — a
Deno 2.9+ install is needed for that one command (the `@alpha` dist-tag only
exists on npm; Deno consumers resolve it through the `npm:` specifier,
ADR-0161). The scaffolded project itself is Node-native: Node.js 24+ and
pnpm run its scripts, and `npx`/`pnpm dlx` entry points for the generator
remain a deferred roadmap item (portable-host tooling,
[#1387](https://github.com/open-element/openelement/issues/1387)).

## Stable 0.43 (maintenance line)

The stable 0.43 line is still published, but it is not the Alpha install path.
A versionless install resolves the npm `latest` dist-tag to it; pin the line
explicitly instead:

```bash
deno run -A npm:@openelement/create@0.43 my-app
```

## Requirements

- **Bootstrap:** Deno 2.9+ for the documented `deno run … npm:…` bootstrap
  command (the verified floor this repository exercises in CI).
- **Generated project:** Node.js 24+ (the floor the packed `@openelement/*`
  engines declare and CI exercises; `.node-version` pins the development
  line) and pnpm for the lifecycle scripts.

## What It Creates

- `package.json` - starter dependencies (exact `@openelement/*` release pins)
  and the lifecycle scripts (`dev`/`check`/`test`/`build`/`start`/`preview`)
- `tsconfig.json` - the type-check surface for `pnpm check`: JSX authoring
  through the element import source, whole-`app/` coverage
- `vite.config.ts` - Vite build configuration; the plugin call is plain
  `openElement()`, because framework options have exactly one home:
- `openelement.config.ts` - the framework options. It is OPTIONAL and nearly
  empty by default; every option it omits comes from a file convention —
  design tokens from `app/styles/tokens.css`, the app shell from
  `app/islands/app-shell.tsx`, structural document-head content from
  `app/head.tsx`, the site title from `package.json`. Passing framework
  options inline to `openElement()` while this file carries options is a hard
  error, and an unknown key fails the build with the accepted-key list.
- `app/` - application directory with starter pages and islands
- `app/routes/blog/` - the sample blog as compiled page routes (`index` list
  and `welcome` post), prerendered at build time
- `public/` - static assets
- `README.md` and `.gitignore` - starter docs and ignore rules

The generated dependency set intentionally keeps protocol and build internals
out of the starter surface. Advanced contracts remain available through the
published workspace packages when a project needs them.

## License

MIT
