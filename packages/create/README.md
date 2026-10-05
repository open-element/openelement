# @openelement/create

Project scaffolding CLI for openElement applications.

Docs and guides: <https://openelement.org>.

> 1.0 Alpha line: the supported creation entry for Element and Router. The
> published npm versions and dist-tags are registry truth (query them with
> `npm view @openelement/create dist-tags`); `latest` stays on the stable 0.43
> line until a separately admitted stable release.

`@openelement/create` generates a new openElement project with the recommended
directory structure, a pnpm-scripted package manifest, Vite setup, and starter
pages. The generated project is a plain Node/pnpm project.

## Usage (1.0 Alpha)

```bash
npm create @openelement@alpha my-app
cd my-app
pnpm install
pnpm dev
```

`npm create @openelement@alpha` rides npm's initializer alias: a bare `@scope`
resolves to `@scope/create` at the same tag, so the canonical spelling names
the scope, and npm runs this package's generator. The version `@alpha` resolves
to is registered in
`the tracked release-state manifest` (currently `1.0.0-alpha.9`, a new baseline —
not a 0.x upgrade, with no migration path from 0.x). Pin that exact version
when reproducibility matters (verify against the live registry with
`npm view @openelement/create dist-tags.alpha`):

```bash
npm create @openelement@1.0.0-alpha.9 my-app
```

The generated starter pins the exact `@openelement/*` versions it was built
from in its `package.json` dependencies.

The canonical install command is exported from `@openelement/create/install-command` (one builder, every documented copy derives from it).

## Tailwind form (the one scaffold question)

The scaffold ships the **Tailwind-ON starter by default**: a preset-wired
`vite.config.ts` (the `@openelement/router` Tailwind preset), the
`app/styles/theme.css` `@theme` role sheet (semantic roles over the Tailwind
default scale), and exact `tailwindcss` / `@tailwindcss/vite` pins in
`devDependencies`. Interactively the CLI asks exactly one question —
`Enable Tailwind CSS + @theme role sheet? (Y/n)` — and every non-interactive
run (CI, packed consumers) takes the same `Y` default. Pass a flag to skip the
question; the flags reach the generator through the spellings that forward
trailing arguments (`npx`, `pnpm dlx`, or a directly invoked bin):

```bash
npx @openelement/create@alpha my-app --no-tailwind   # the minimal starter
npx @openelement/create@alpha my-app --tailwind      # explicit ON (the default)
```

`--no-tailwind` generates the pre-#1524 minimal starter: no Tailwind
dependency surface, no preset wiring, no role sheet.

## The bootstrap is a plain npm invocation; the generated project is Node

The documented bootstrap runs the generator through `npm create` (or the
`npx` short form, or `pnpm dlx`) — plain Node tooling, no second runtime.
Node.js 24.2+ is the only host requirement for both the bootstrap and the
generated project. The packed package ships two equivalent npm bins
(`openelement-create`, `create-openelement`, both the same entry), so the pnpm
form must name one explicitly:

```bash
npx @openelement/create@alpha my-app
pnpm dlx --package=@openelement/create@alpha openelement-create my-app
```

The scaffolded project itself is Node-native: Node.js 24.2+ and
pnpm run its scripts.

## Stable 0.43 (maintenance line)

The stable 0.43 line is still published, but it is not the Alpha install path.
A versionless install resolves the npm `latest` dist-tag to it; pin the line
explicitly instead:

```bash
npm create @openelement@0.43 my-app
```

## Requirements

- **Bootstrap:** Node.js 24.2+ with npm (or pnpm for the `pnpm dlx` variant) —
  the verified floor this repository exercises in CI.
- **Generated project:** Node.js 24.2+ (the floor the packed `@openelement/*`
  engines declare and CI exercises; `.node-version` pins the development
  line) and pnpm for the lifecycle scripts.

## What It Creates

- `package.json` - starter dependencies (exact `@openelement/*` release pins)
  and the lifecycle scripts (`dev`/`check`/`test`/`build`/`start`/`preview`);
  the default (Tailwind-ON) form adds the exact `tailwindcss` and
  `@tailwindcss/vite` dev pins
- `tsconfig.json` - the type-check surface for `pnpm check`: JSX authoring
  through the element import source, whole-`app/` coverage
- `vite.config.ts` - Vite build configuration. On the default (Tailwind-ON)
  form it also applies the router's public Tailwind preset so the role sheet
  compiles into the linked bundle; framework options still have exactly one
  home:
- `openelement.config.ts` - the framework options. It is OPTIONAL and nearly
  empty by default; every option it omits comes from a file convention —
  design tokens from `app/styles/tokens.css`, the app shell from
  `app/islands/app-shell.tsx`, structural document-head content from
  `app/head.tsx`, the site title from `package.json`. Passing framework
  options inline to `openElement()` while this file carries options is a hard
  error, and an unknown key fails the build with the accepted-key list.
- `app/` - application directory with starter pages and islands; the
  Tailwind-ON form adds `app/styles/theme.css`, the `@theme` role sheet
- `app/routes/blog/` - the sample blog as compiled page routes (`index` list
  and `welcome` post), prerendered at build time
- `public/` - static assets
- `README.md` and `.gitignore` - starter docs and ignore rules

The generated dependency set intentionally keeps protocol and build internals
out of the starter surface. Advanced contracts remain available through the
published workspace packages when a project needs them.

## License

MIT
