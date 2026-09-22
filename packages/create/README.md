# @openelement/create

Project scaffolding CLI for openElement applications.

Docs and guides: <https://openelement.org>.

> 1.0 Alpha line: the supported creation entry for Element and Router. The
> published npm versions and dist-tags are registry truth (query them with
> `npm view @openelement/create dist-tags`); `latest` stays on the stable 0.43
> line until a separately admitted stable release.

`@openelement/create` generates a new openElement project with the recommended
directory structure, Deno configuration, Vite setup, and starter pages.

## Usage (1.0 Alpha)

```bash
deno run -A npm:@openelement/create@alpha my-app
cd my-app
deno task dev
```

The version `@alpha` resolves to is registered in
`the tracked release-state manifest` (currently `1.0.0-alpha.2`, a new baseline —
not a 0.x upgrade, with no migration path from 0.x). Pin that exact version
when reproducibility matters (verify against the live registry with
`npm view @openelement/create dist-tags.alpha`):

```bash
deno run -A npm:@openelement/create@1.0.0-alpha.2 my-app
```

`--minimum-dependency-age 0` is needed because Deno's default
minimumDependencyAge (~24h) refuses packages published within the last day.

The generated starter pins the exact `@openelement/*` versions it was built
from in its `deno.json` import map.

The canonical install command is exported from `@openelement/create/install-command` (one builder, every documented copy derives from it).

## Do not run the bin under Node (`npx`)

> **Use the bare-flag create command documented above. Do not use
> `npx @openelement/create` / `npx create-openelement`.** The CLI is a Deno
> program: it is written against the Deno API, and its `bin` entries and
> shebang (`#!/usr/bin/env -S deno run --allow-read --allow-write`) both assume
> a Deno host. Under a plain Node host the bin dies at startup with
> `ReferenceError: Deno is not defined`.
>
> A Node-executable entry point is a deferred roadmap item (portable-host
> tooling, [#1387](https://github.com/open-element/openelement/issues/1387)).
> Until it lands, the bare-flag create form is the
> supported install path.

## Stable 0.43 (maintenance line)

The stable 0.43 line is still published, but it is not the Alpha install path.
A versionless install resolves the npm `latest` dist-tag to it; pin the line
explicitly instead:

```bash
deno run -A npm:@openelement/create@0.43 my-app
```

## Requirements

**Deno 2.9+.** The generated starter writes the `minimumDependencyAge` config
key into its `deno.json` (a key introduced in Deno 2.5.5); the 2.9 floor is the
toolchain this repository pins in `.dvmrc`, exercises in CI, and verifies in
its native-pack, scaffold, package, and consumer proof. No earlier version is
claimed or tested.

## What It Creates

- `deno.json` - starter authoring imports and build tasks
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

The generated import map intentionally keeps protocol and build internals out of
the starter surface. Advanced contracts remain available through the published
workspace packages when a project needs them.

## License

MIT
