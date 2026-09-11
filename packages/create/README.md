# @openelement/create

Project scaffolding CLI for openElement applications.

> Stable surface (frozen under ADR-0122):
> Framework product entry. This package is part of the
> first-run Framework story alongside `@openelement/router` and
> `@openelement/router` lifecycle tooling.

`@openelement/create` generates a new openElement project with the recommended
directory structure, Deno configuration, Vite setup, and starter pages.

## Usage

```bash
deno run -A --minimum-dependency-age 0 npm:@openelement/create my-app
cd my-app
deno task dev
```

The default dist-tag is the stable 0.43 line, and
`--minimum-dependency-age 0` is needed because Deno's default
minimumDependencyAge (~24h) refuses packages published within the last day.

## Requirements

**Deno 2.8+.** The generated starter writes the `minimumDependencyAge` config
key into its `deno.json` (a key introduced in Deno 2.5.5) and is exercised
against the same toolchain the repo pins in CI (2.9.x, see `.dvmrc`); 2.8 is
the declared support floor. Older Deno versions do not understand the key and
will warn or error.

## What It Creates

- `deno.json` - starter authoring imports and build tasks
- `vite.config.ts` - Vite build configuration with the openElement plugin
- `app/` - application directory with starter pages and islands
- `content/blog/` - a sample markdown post wired into the generated blog-data
  module
- `public/` - static assets
- `README.md` and `.gitignore` - starter docs and ignore rules

The generated import map intentionally keeps protocol and build internals out of
the starter surface. Advanced contracts remain available through the published
workspace packages when a project needs them.

## License

MIT
