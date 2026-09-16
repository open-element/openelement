# @openelement/create

Project scaffolding CLI for openElement applications.

> 1.0 Alpha line: the supported creation entry for Element and Router. The
> published npm versions and dist-tags are registered in
> `docs/release/release-state.json` (registry-verified); `latest` stays on the
> stable 0.43 line until a separately admitted stable release.

`@openelement/create` generates a new openElement project with the recommended
directory structure, Deno configuration, Vite setup, and starter pages.

## Usage (1.0 Alpha)

```bash
deno run --allow-read --allow-write --allow-env --allow-net --deny-ffi --no-prompt --minimum-dependency-age 0 npm:@openelement/create@alpha my-app
cd my-app
deno task dev
```

The version `@alpha` resolves to is registered in
`docs/release/release-state.json`; pin that exact version with
`npm:@openelement/create@<version>` when reproducibility matters.
`--minimum-dependency-age 0` is needed because Deno's default
minimumDependencyAge (~24h) refuses packages published within the last day.

The generated starter pins the exact `@openelement/*` versions it was built
from in its `deno.json` import map.

## Stable 0.43 (maintenance line)

The stable 0.43 line is still published, but it is not the Alpha install path.
A versionless install resolves the npm `latest` dist-tag to it; pin the line
explicitly instead:

```bash
deno run --allow-read --allow-write --allow-env --allow-net --deny-ffi --no-prompt --minimum-dependency-age 0 npm:@openelement/create@0.43 my-app
```

## Requirements

**Deno 2.9+.** The generated starter writes the `minimumDependencyAge` config
key into its `deno.json` (a key introduced in Deno 2.5.5); the 2.9 floor is the
toolchain this repository pins in `.dvmrc`, exercises in CI, and verifies in
its native-pack, scaffold, package, and consumer proof. No earlier version is
claimed or tested.

## What It Creates

- `deno.json` - starter authoring imports and build tasks
- `vite.config.ts` - Vite build configuration with the openElement plugin
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
