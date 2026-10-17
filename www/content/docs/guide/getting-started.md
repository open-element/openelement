---
title: 'Getting Started'
lede: 'OpenElement is a Web Components-native, static-first application framework. Start with standard Custom Elements, pages, routes, selective upgrades and deployable Vite/Nitro output.'
order: 1
---

> {{SOURCE_LINE_NOTE}} Registry truth lives in [`docs/release/release-state.json`](https://github.com/open-element/openelement/blob/main/docs/release/release-state.json) — there is no supported migration from 0.x.

## Install

Four commands to a running app:

```bash
{{INSTALL_COMMAND}}
cd my-app
npm install
npm run dev
```

The version the install command resolves is registered in [`docs/release/release-state.json`](https://github.com/open-element/openelement/blob/main/docs/release/release-state.json), the repository's registry-verified source of truth: the scaffold writes `@openelement/*` caret ranges over that release into the generated `package.json`, so no extra flags are involved and later `1.0.0` prereleases arrive through `npm update`.

The scaffold ships one form, Tailwind-ON: a preset-wired `vite.config.ts`, the `app/styles/theme.css` `@theme` role sheet (semantic roles over the Tailwind default scale), and exact `tailwindcss` / `@tailwindcss/vite` dev pins. There is no flag and no second template — the styling surface is not a scaffold variant. Turning Tailwind off is a project edit rather than a flag, and the two edits it is made of do different things. Pointing `tailwind` at your own sheet KEEPS Tailwind selected: that key is what chooses the engine, so the pipeline still runs, still compiles the sources you name, and the utilities your components use still come from the engine — it is the token source that changed, not the compiler. Removing the key switches the pipeline off entirely (`false` and an absent key are the same to the plan unless an admitted package declares its own `openElement.tailwind` need): no peer is loaded and no utility sheet is emitted. A token file supplies CSS custom properties; it does not supply the utilities the starter's markup already names, so a project that removes the key either authors those styles itself or keeps them out of its markup. The `app/styles/tokens.css` convention supplies the document's tokens in that mode — it is not a substitute for the compiler.

> The generated project is a plain Node app (ADR-0161): Node.js 24.2+ runs its scripts under any package manager (npm, pnpm, yarn, or bun) — Node 24.2 is the verified floor the packed packages declare and CI exercises (the Router CLI relies on `import.meta.main`, added in Node 24.2.0; `.node-version` pins the 24.18 development line). The bootstrap command itself is a plain Node invocation, so the whole flow needs only Node and a package manager; the earlier Deno bootstrap was retired by the 2026-10-03 ADR-0161 amendment.

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

## Explore

Read the [docs](/docs), [API reference](/reference), and [roadmap](/roadmap) as the current product map.

## Build

`npm run build` produces the deployable site in `dist/` — prerendered HTML for every static route, everything under `public/` copied as-is, and, when the app has islands or request-time routes, the client chunks and the server entry beside it. That directory is the artifact: upload it to any static host, or point a Node/Workers deployment at `dist/server/index.js`.

Two scripts cover the build-and-serve loop:

```bash
npm run build  # prerender into dist/ (+ dist/client, dist/server when needed)
npm start      # serve the real build, including request-time routes
```

`npm start` is the one to check a change against, because it serves the same output production does and dispatches dynamic routes and form posts to the generated server entry. For a project whose build has no request-time route, the router command also carries a static-only mode — `openelement start --mode=preview` — which refuses a build that has a server side rather than silently hiding it. Port comes from `OPEN_ELEMENT_PORT` (falling back to `PORT`, default 4173) and host from `OPEN_ELEMENT_HOST`.

Before shipping, `npm run typecheck` type-checks the app and `npm test` runs its tests; both are wired into the starter's scripts and need no extra setup. The full output contract — which files the build writes and what each one answers — is documented under [Deployment](/guide/deployment).

## See also

- [Core Concepts](/guide/core-concepts) — the component model behind the starter's files.
- [Routing and Data](/guide/routing-and-data) — pages, loaders and actions.
- [Deployment](/guide/deployment) — what `npm run build` emits and how to verify it.
