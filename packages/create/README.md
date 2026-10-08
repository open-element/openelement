# @openelement/create

Project scaffolding CLI for openElement applications.

Docs and guides: <https://openelement.org>.

> 1.0 Alpha line: the supported creation entry for Element and Router. The
> published npm versions and dist-tags are registry truth (query them with
> `npm view @openelement/create dist-tags`); `latest` stays on the stable 0.43
> line until a separately admitted stable release.

`@openelement/create` generates a new openElement project from ONE template —
the showcase starter: a static-first landing page with two islands, a fully
static About page, an `/api/ping` server route, and a pure-CSS design-token
sheet (no Tailwind, no template variants). The generated project is a plain
Node/pnpm project.

## Usage (1.0 Alpha)

```bash
npm create @openelement@alpha my-app
```

The CLI scaffolds, initializes git (when git is available), detects a package
manager (pnpm first, then npm), installs dependencies, and prints a boxed
handoff with the next commands. Flags (all optional):

| Flag | Default | Meaning |
| --- | --- | --- |
| `-t, --template <name>` | `showcase` | the template to scaffold; skips the interactive confirmation |
| `--install` / `--no-install` | install | dependency installation after scaffolding |
| `--start` | off | start the dev server after a successful install |
| `--git` / `--no-git` | git init | initialize a git repository (requires the scaffold's `.gitignore`) |

On a TTY the CLI asks exactly one question — confirming the template (Enter
accepts the default). Non-interactive runs (CI, packed consumers) skip the
prompt and take the defaults; pass `-t` to pin the template explicitly.

```bash
npx @openelement/create@alpha my-app --no-install --no-git -t showcase
```

`npm create @openelement@alpha` rides npm's initializer alias: a bare `@scope`
resolves to `@scope/create` at the same tag, so the canonical spelling names
the scope, and npm runs this package's generator. The version `@alpha` resolves
to is registered in
`the tracked release-state manifest` (currently `1.0.0-alpha.10`, a new baseline —
not a 0.x upgrade, with no migration path from 0.x). Pin that exact version
when reproducibility matters (verify against the live registry with
`npm view @openelement/create dist-tags.alpha`):

```bash
npm create @openelement@1.0.0-alpha.10 my-app
```

The generated starter pins the exact `@openelement/*` versions it was built
from in its `package.json` dependencies.

The canonical install command is exported from `@openelement/create/install-command` (one builder, every documented copy derives from it).

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
- **git (optional):** `git init` runs by default and skips silently when git
  is not on PATH.

## What It Creates

- `package.json` - starter dependencies (exact `@openelement/*` release pins)
  and the lifecycle scripts (`dev`/`check`/`test`/`build`/`start`/`preview`)
- `tsconfig.json` - the type-check surface for `pnpm check`: JSX authoring
  through the element import source, whole-`app/` coverage
- `vite.config.ts` - Vite build configuration only; framework options still
  have exactly one home:
- `openelement.config.ts` - the framework options. It is OPTIONAL and nearly
  empty by default; every option it omits comes from a file convention —
  design tokens from `app/styles/theme.css` (the @theme role sheet), structural document-head
  content from `app/head.tsx`, the site title from `package.json`. Passing
  framework options inline to `openElement()` while this file carries options
  is a hard error, and an unknown key fails the build with the accepted-key
  list.
- `app/` - the showcase application:
  - `app/routes/` — page routes (`/`, `/about`, the styled 404), prerendered
    at build time (SSG)
  - `app/routes/api/ping.ts` — a request-time server route returning
    `Response.json`
  - `app/islands/` — the two islands (`my-counter` hydrating on idle,
    `live-timer` client-only), the only code that ships JavaScript
  - `app/components/` — compiled page elements and their style sheets
    (`.css` files next to each element; `site-chrome.css`/`badges.css` are
    the shared sheets)
  - `app/styles/theme.css` — the @theme role sheet, Tailwind-ON single-default
    scaffold form (dark values ride
    `prefers-color-scheme`)
- `public/` - static assets
- `README.md` and `.gitignore` - starter docs and ignore rules

The generated dependency set intentionally keeps protocol and build internals
out of the starter surface. Advanced contracts remain available through the
published workspace packages when a project needs them.

## License

MIT
