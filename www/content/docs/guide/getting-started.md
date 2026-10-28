---
title: 'Getting Started'
lede: 'OpenElement is a Web Components-native, static-first app framework: standard Custom Elements, pages, routes, selective upgrades, Vite/Nitro output.'
order: 1
---

> {{SOURCE_LINE_NOTE}} Registry truth lives in [`docs/release/release-state.json`](https://github.com/open-element/openelement/blob/main/docs/release/release-state.json) — there is no supported migration from 0.x.

This page gets a new project running, then walks one page, one extra element and one build. Every step ends with something you can see; the internals come after the flow, not before it.

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

The version the install command resolves is registered in [`docs/release/release-state.json`](https://github.com/open-element/openelement/blob/main/docs/release/release-state.json), the repository's registry-verified source of truth: the scaffold writes `@openelement/*` caret ranges over that release into the generated `package.json`, so no extra flags are involved and later `1.0.0` prereleases arrive through `npm update`.

> The generated project is a plain Node app (ADR-0161): Node.js 24.2+ runs its scripts under any package manager (npm, pnpm, yarn, or bun) — Node 24.2 is the verified floor the packed packages declare and CI exercises (the Router CLI relies on `import.meta.main`, added in Node 24.2.0; `.node-version` pins the 24.18 development line). The bootstrap command itself is a plain Node invocation, so the whole flow needs only Node and a package manager; the earlier Deno bootstrap was retired by the 2026-10-03 ADR-0161 amendment.

## Verify

Success looks like this:

- The scaffold prints one `created <path>` line per generated file, then a handoff box naming the next commands in the package manager's spelling.
- `npm run dev` prints its ready line and the local URL — `http://localhost:5173/` by default.
- Opening that URL shows the starter's home page: the heading "Rendered before JavaScript arrives", the static badges, an interactive counter island and a client-only live timer. The page is already styled and readable; the islands wake up after it loads.

If something goes wrong before that:

| Symptom | What happened | What to do |
| --- | --- | --- |
| `This CLI requires Node.js 24.2.0 or newer` | the host's `node` is below the supported floor | run the same command on Node 24.2+ (the project's `.node-version` pins the 24.18 line); check `node --version` first |
| `npm run dev` reports the port is in use | Vite defaults to 5173 and moves to the next free port unless asked to be strict | open the `Local:` URL it printed, or pin one — npm: `npm run dev -- --port 5180 --strictPort`; pnpm/yarn: `pnpm run dev --port 5180 --strictPort` (a first run under a second package manager re-installs dependencies) |
| the install step fails, or `No package manager found` | the scaffold writes every project file before it installs; the failure is the install, not the scaffold | fix the network, registry or `PATH`, then install inside the project: `cd my-app && npm install` (or the same command for your manager) |
| the install fails offline or against a private registry | dependency install is the only step that talks to the registry | scaffold without it using the generator's `--no-install` flag (pass it through your package manager), then install once the registry is reachable |
| you use pnpm, yarn or bun | the scaffold installs with the manager it was invoked through, else the first of pnpm/npm/yarn/bun on `PATH` | keep using your manager — the scripts are manager-neutral: `pnpm run dev`, `yarn dev` and `bun run dev` all reach the same dev server |

## Understand the project

The scaffold writes one small directory. Every path has one job:

```text
my-app/
  app/
    routes/          one file per URL — index.tsx (/), about.tsx (/about),
                     404.tsx, api/ping.ts (/api/ping)
    components/      the compiled page elements and the .css sheets they array
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

One URL is one file: `app/routes/hello.tsx` answers `/hello`. The markup does not live in the route file — it belongs to a compiled element under `app/components/` (or directly in the route for a small server function page), the shared chrome lives once in `app/layout.tsx`, and only `app/islands/` opts code into client delivery. [Core Concepts](/guide/core-concepts) explains the model behind those files; [Routing and Data](/guide/routing-and-data) covers the route contract.

## Build a page

A new URL needs two files: the route module and the compiled element that owns its markup.

`app/components/page-hello.tsx`:

```tsx
import { element, OpenElement } from '@openelement/element';

@element('hello-page', { root: 'light' })
export default class HelloPage extends OpenElement {
  render() {
    return (
      <main>
        <h1>Hello from a page</h1>
        <p>This markup is server-rendered HTML, with no client JavaScript.</p>
      </main>
    );
  }
}
```

`app/routes/hello.tsx`:

```ts
import { definePage } from '@openelement/router';
import HelloPage from '../components/page-hello.tsx';

export default definePage(HelloPage, {
  head: {
    title: 'Hello — my-app',
    description: 'The first page of the tutorial app.',
  },
});
```

The route is a binding: the class owns the markup, the route module hands it to `definePage` with the page's head metadata, and the file name owns the URL. The dev server picks both files up without a restart.

Expected result: opening `http://localhost:5173/hello` shows the heading. Open the page source (or `curl -s http://localhost:5173/hello | grep -o 'Hello from a page'`) and the heading is in the HTML the server sent — it is not injected by script. The route itself adds no island, so this page ships no client module of its own.

## Add a Custom Element

A second compiled module is an ordinary Custom Element: declare it with `@element`, give it a `@property`, and host it by tag.

`app/components/my-badge.tsx`:

```tsx
import { element, OpenElement, property } from '@openelement/element';

@element('my-badge', { root: 'light' })
export default class MyBadge extends OpenElement {
  @property({ reflect: false })
  label = 'new';

  render() {
    return <span class="badge">{this.label}</span>;
  }
}
```

Host it in the page you already have — `app/components/page-hello.tsx` becomes:

```tsx
import { element, OpenElement } from '@openelement/element';
import './my-badge.tsx';

@element('hello-page', { root: 'light' })
export default class HelloPage extends OpenElement {
  render() {
    return (
      <main>
        <h1>Hello from a page</h1>
        <p>This markup is server-rendered HTML, with no client JavaScript.</p>
        <my-badge label="hello"></my-badge>
      </main>
    );
  }
}
```

Two rules make that work: the page module imports the badge module (`import './my-badge.tsx'`), so the route import chain reaches it and the build registers its tag; and the literal `label="hello"` on the host seeds the badge's `@property` during the server render.

Expected result: `/hello` now contains the badge's server-rendered markup — `<my-badge>` with a `<span class="badge">hello</span>` inside. Because the badge is a page-scope component and not an island, no client module for it ships: the browser never upgrades it, and the markup is the artifact. Anything that must react in the browser takes the island form instead — see [Islands and SSR](/guide/islands-and-ssr).

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

To deploy: upload `dist/` to a static host when the build emitted no `dist/server/`; when it did, deploy the static files plus a Node/Workers runtime pointed at `dist/server/index.js`. The full output contract — which files the build writes and what each one answers — is documented under [Deployment](/guide/deployment). Before shipping, `npm run typecheck` type-checks the app and `npm test` runs the starter's `node --test` suite — the template ships no test files yet, so add `*.test.ts` next to the code you want covered; both scripts are wired into the starter and need no extra setup.

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

The scaffold is optional. A project that wants only the component runtime adds two packages — the runtime its compiled components load, and the compiler that turns TSX into the Part Program at build time:

```bash
npm install @openelement/element
npm install -D @openelement/compiler
```

Both lines are required. `@openelement/element` depends on `@openelement/protocol` and the signals core, and on nothing else — it does **not** bring the compiler, so a project that stops after the first line has the runtime but cannot build a component. The compiler is the build-time half and belongs in `devDependencies`; it is what the Vite seam below is imported from.

- **Vite projects** mount the compiler through the package's Vite seam: `import { element } from '@openelement/compiler/vite'` and add `element()` to `plugins`. The plugin compiles each component's TSX `render()` into the Part Program at build time. Any host that runs the plugin — the Router's Vite build, or a bare Vite project — is enough; the compiler is not part of the runtime.
- **Other bundlers** drive the same compiler programmatically through `@openelement/compiler` — the TSX-to-Part-Program core the Vite plugin itself calls — and wire its output into their own pipeline.
- **The output is standard Custom Elements.** A compiled component is a plain class you register with `customElements.define`, so the emitted bundle loads in any page or framework with no runtime to vendor and no compiler to run: consuming an already-compiled bundle is a `<script type="module">` in plain HTML and needs neither package. That consumer path is verified on every release: the packed-artifact qualification builds a component with the `@openelement/element` and `@openelement/compiler` tarballs in a project with no Router and no scaffold, then loads the resulting bundle from a separate plain-HTML page in three browsers (`tools/release/consumer-packaged-element.ts`).
