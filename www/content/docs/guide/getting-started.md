---
title: 'Getting Started'
lede: 'OpenElement is a Web Components-native, static-first app framework: standard Custom Elements, pages, routes, selective upgrades, Vite/Nitro output.'
order: 1
---

> {{SOURCE_LINE_NOTE}}

Scaffold a project, verify it, then add a page and an element and build for production.

## Install

**Before you start:** Node.js 24.2 or newer and a package manager (`npm`, `pnpm`, `yarn`, or `bun`). Check the runtime first:

```text
node --version   # must print v24.2.0 or newer
```

Three commands to a running app — the generator installs the dependencies
itself (with the invoking package manager, or the first one it finds on `PATH`),
so there is no separate install step:

```bash
{{INSTALL_COMMAND}}
cd my-app
npm run dev
```

What each step does:

- `{{INSTALL_COMMAND}}` — fetch the published create CLI (a versionless install resolves `latest`, the current 1.0 line), scaffold the showcase starter into `my-app/`, and install its dependencies.
- `cd my-app` — enter the generated project.
- `npm run dev` — start the project's Vite dev server.

The scaffold uses the release behind the npm `latest` tag. See [Release Status](/changelog) for the published version and the source preview. The generated project runs its scripts with npm, pnpm, yarn or bun.

## Verify

Success looks like this:

- The scaffold prints one `created <path>` line per generated file, then a handoff box naming the next commands in the package manager's spelling.
- `npm run dev` prints its ready line and the local URL — `http://localhost:5173/` by default.
- Open that URL and try the counter. The timer starts in the browser. Edit the heading in `app/routes/index.tsx` and save to see the home page update.

If something goes wrong before that:

| Symptom | What happened | What to do |
| --- | --- | --- |
| `This CLI requires Node.js 24.2.0 or newer` | the host's `node` is below the supported floor | run the same command on Node 24.2+ (the project's `.node-version` pins the 24.18 line); check `node --version` first |
| `npm run dev` reports the port is in use | Vite defaults to 5173 and moves to the next free port unless asked to be strict | open the `Local:` URL it printed, or pin one — npm: `npm run dev -- --port 5180 --strictPort`; pnpm/yarn: `pnpm run dev --port 5180 --strictPort` (a first run under a second package manager re-installs dependencies) |
| the install step fails, or `No package manager found` | the scaffold writes every project file before it installs; the failure is the install, not the scaffold | fix the network, registry or `PATH`, then install inside the project: `cd my-app && npm install` (or the same command for your manager) |
| the install fails offline or against a private registry | dependency install is the only step that talks to the registry | scaffold without it using the generator's `--no-install` flag (pass it through your package manager), then install once the registry is reachable |
| you use pnpm, yarn or bun | the scaffold installs with the manager it was invoked through, else the first of pnpm/npm/yarn/bun on `PATH` | keep using your manager — the scripts are manager-neutral: `pnpm run dev`, `yarn dev` and `bun run dev` all reach the same dev server |

To run the examples below, use the project created by the [source preview steps](https://github.com/open-element/openelement/blob/main/README.md#preview-the-source-checkout).

## Understand the project

The scaffold writes one small directory. Every path has one job:

```text
my-app/
  app/
    routes/          one file per URL — index.tsx (/), about.tsx (/about),
                     404.tsx, api/ping.ts (/api/ping)
    (components/     page-scope components, when you add one)
    islands/         modules that opt into client delivery (my-counter, live-timer)
    layout.tsx       the auto-registered site chrome wrapped around every page
    head.tsx         structural <head> entries — here the color-scheme meta
    styles/theme.css the @theme token sheet every utility reads
  public/            static assets copied into dist/ as-is
  openelement.config.ts  framework options: the Tailwind entry, head, conventions
  vite.config.ts     Vite configuration; the plugin call stays bare
  tsconfig.json      the app's type-check surface
  package.json       dependencies + the dev/build/start/test/fmt/lint/typecheck scripts
  .node-version      the Node line the project pins
```

The site also writes `README.md`, an `AGENTS.md` agent pointer and `.gitignore`, and initializes a git repository unless the target already lives inside one.

One URL is one file: `app/routes/hello.tsx` answers `/hello`. For a page that is mostly static text, the route module declares the component itself and wraps it in `definePage`; a page whose markup belongs in its own component module under `app/components/` imports that component instead. The shared chrome lives once in `app/layout.tsx`, and only `app/islands/` opts code into client delivery. [Core Concepts](/guide/core-concepts) explains the model behind those files; [Routing and Data](/guide/routing-and-data) covers the route contract.

## Build a page

A new URL is one file. A page that renders static text with no client behavior is a **server function page**: the route module exports the component itself and wraps it with `definePage`.

`app/routes/hello.tsx`:

```tsx
import { definePage } from '@openelement/router';

export const loader = async () => ({ title: 'Hello from a page' });

export function HelloPage(props: { title: string }) {
  return (
    <main>
      <h1>{props.title}</h1>
      <p>This markup is server-rendered HTML, with no client JavaScript.</p>
    </main>
  );
}

export default definePage(HelloPage, {
  head: {
    title: 'Hello — my-app',
    description: 'The first page of the tutorial app.',
  },
});
```

The component is the module's own exported function, passed to `definePage` by identifier, and the file name owns the URL. The compiler lowers it into a generative HTML constructor, so the page is server-only by construction: it produces no Part Program, no property machinery and never reaches the client, which is why this page ships no JavaScript of its own. The dev server picks the file up without a restart.

Expected result: opening `http://localhost:5173/hello` shows the heading. Open the page source (or `curl -s http://localhost:5173/hello | grep -o 'Hello from a page'`) and the heading is in the HTML the server sent — it is not injected by script. The route itself adds no island, so this page ships no client module of its own.

## Add a Custom Element

A second module is an ordinary Custom Element: a function component beside a `defineIslandConfig` sidecar that pins its tag, its root and its properties.

`app/components/my-badge.tsx`:

```tsx
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'my-badge',
  // A light root renders into the document, so the page's own styles reach the
  // badge's children with no shadow boundary in the way.
  root: 'light',
  // Page-scope: the server renders this component and the browser never
  // upgrades it, so no chunk for it exists.
  hydrate: 'none',
  ssr: true,
  properties: { label: { default: 'new' } },
});

export default function MyBadge(props: { label: string }) {
  return <span class='badge'>{props.label}</span>;
}
```

Host it in the page you already have — `app/routes/hello.tsx` becomes:

```tsx
import { definePage } from '@openelement/router';
// The side-effect import registers the tag on the route import chain, which is
// how the build learns the page reaches this component.
import '../components/my-badge.tsx';

export const loader = async () => ({ title: 'Hello from a page' });

export function HelloPage(props: { title: string }) {
  return (
    <main>
      <h1>{props.title}</h1>
      <p>This markup is server-rendered HTML, with no client JavaScript.</p>
      <my-badge label='hello'></my-badge>
    </main>
  );
}

export default definePage(HelloPage, { head: { title: 'Hello — my-app' } });
```

Two rules make that work: the page module imports the badge module (`import '../components/my-badge.tsx'`), so the route import chain reaches it and the build registers its tag; and the literal `label='hello'` on the host seeds the declared property during the server render.

Expected result: `/hello` now contains the badge's server-rendered markup — `<my-badge>` with a `<span class="badge">hello</span>` inside. Because the badge declares `hydrate: 'none'`, no client module for it ships: the browser never upgrades it, and the markup is the artifact. Anything that must react in the browser takes an island delivery strategy instead — see [Islands and SSR](/guide/islands-and-ssr).

## Build and deploy

```bash
npm run build  # prerender into dist/ (+ dist/client, dist/server when needed)
npm start      # serve the real build, including request-time routes
```

`npm run build` produces the deployable site in `dist/`. For the starter that is:

- `dist/index.html` and `dist/about/index.html` — prerendered HTML for the static routes;
- everything under `public/` copied as-is (the starter's `openelement-mark.svg`);
- `dist/client/` — the shared client entry and one chunk per reachable island, because the starter has islands;
- `dist/island-manifests/` — one JSON per page recording which island it loads and when;
- `dist/server/` — the request-time entry, emitted because the starter's styled 404 route declares `renderIntent: { mode: 'dynamic' }`.

`npm start` is the one to check a change against, because it serves the same output production does and dispatches dynamic routes and form posts to the generated server entry. Port comes from `OPEN_ELEMENT_PORT` (falling back to `PORT`, default 4173) and host from `OPEN_ELEMENT_HOST`. For a project whose build has no request-time route, the router command also carries a static-only mode — `openelement start --mode=preview` — which refuses a build that has a server side rather than silently hiding it.

Run `npx oe publish --check` before uploading `dist-public/`. If the build emitted `dist/server/`, also deploy a Node or Workers runtime for `dist/server/index.js`. The full output contract — which files the build writes and what each one answers — is documented under [Deployment](/guide/deployment). Before shipping, `npm run typecheck` type-checks the app and `npm test` runs the starter's `node --test` suite — the source preview includes a test for the `/api/ping` response. Add more `*.test.ts` files under `tests/`. Both scripts need no extra setup.

## Go deeper

- [Tutorial: Your First App](/guide/tutorial) — the same flow at full length: page, island, form action, build and serve.
- [Configuration](/guide/configuration) — the options file, routes and middleware that shape the build.
- [The compiled module grammar](/guide/compiled-grammar) — what the compiler admits, and what fails the build instead of falling back at runtime.
- [Routing and Data](/guide/routing-and-data) — loaders, actions and the props projector.
- [Islands and SSR](/guide/islands-and-ssr) — how delivery is declared, and what actually ships to the browser.
- [Deployment](/guide/deployment) — the output contract and the Nitro presets.
- [Testing](/guide/testing) — the checks worth running against a build.

The two sections below are reference material for later: the styling the starter ships, and the path for a project that wants only the element runtime. The product map beyond this guide is [Docs](/docs), the [API reference](/reference) and the [roadmap](/roadmap).

## Styling and the Tailwind preset

The scaffold ships one form, Tailwind-ON: a preset-wired `vite.config.ts`, the `app/styles/theme.css` `@theme` role sheet (semantic roles over the Tailwind default scale), and exact `tailwindcss` / `@tailwindcss/vite` dev pins. There is no flag and no second template — the styling surface is not a scaffold variant. Turning Tailwind off is a project edit rather than a flag, and the two edits it is made of do different things. Pointing `tailwind` at your own sheet KEEPS Tailwind selected: that key is what chooses the engine, so the pipeline still runs, still compiles the sources you name, and the utilities your components use still come from the engine — it is the token source that changed, not the compiler. Removing the key switches the pipeline off entirely (`false` and an absent key are the same to the plan unless an admitted package declares its own `openElement.tailwind` need): no peer is loaded and no utility sheet is emitted. A token file supplies CSS custom properties; it does not supply the utilities the starter's markup already names, so a project that removes the key either authors those styles itself or keeps them out of its markup. The `app/styles/tokens.css` convention supplies the document's tokens in that mode — it is not a substitute for the compiler.

[Styling](/guide/styling) covers where page styles live and what crosses a shadow boundary; [Configuration](/guide/configuration) documents the `tailwind` key itself.

## Using element as a library

The scaffold is optional. A project that wants only the component runtime adds two packages — the runtime its compiled components load, and the compiler that turns TSX into a generated custom element at build time:

```bash
npm install @openelement/element
npm install -D @openelement/compiler
```

Both lines are required. `@openelement/element` depends on `@openelement/protocol` and the signals core, and on nothing else — it does **not** bring the compiler, so a project that stops after the first line has the runtime but cannot build a component. The compiler is the build-time half and belongs in `devDependencies`; it is what the Vite seam below is imported from.

- **Vite projects** mount the compiler through the package's Vite seam: `import { element } from '@openelement/compiler/vite'` and add `element()` to `plugins`. The plugin compiles each component module — the function component and its sidecar — into a Native Custom Element at build time. Any host that runs the plugin — the Router's Vite build, or a bare Vite project — is enough; the compiler is not part of the runtime.
- **Other bundlers** drive the same compiler programmatically through `@openelement/compiler` — the TSX-to-element core the Vite plugin itself calls — and wire its output into their own pipeline.
- **The output is standard Custom Elements.** A compiled component is a plain constructor the module registers as its default export, so the emitted bundle loads in any page or framework with no runtime to vendor and no compiler to run: consuming an already-compiled bundle is a `<script type="module">` in plain HTML and needs neither package. That consumer path is verified on every release: the packed-artifact qualification builds a component with the `@openelement/element` and `@openelement/compiler` tarballs in a project with no Router and no scaffold, then loads the resulting bundle from a separate plain-HTML page in three browsers (`tools/release/consumer-packaged-element.ts`).
