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
pnpm install
pnpm dev
```

The version the install command resolves is registered in [`docs/release/release-state.json`](https://github.com/open-element/openelement/blob/main/docs/release/release-state.json), the repository's registry-verified source of truth: the scaffold writes the resolved exact `@openelement/*` pins into the generated `package.json`, so no extra flags are involved.

The scaffold ships the Tailwind-ON starter by default: a preset-wired `vite.config.ts`, the `app/styles/theme.css` `@theme` role sheet (semantic roles over the Tailwind default scale), and exact `tailwindcss` / `@tailwindcss/vite` dev pins. Pass `--no-tailwind` to the create command (for example through the `npx @openelement/create@alpha <project-name>` spelling) for the minimal starter without the Tailwind surface.

> The generated project is a plain Node/pnpm app (ADR-0161): Node.js 24.2+ and pnpm run its scripts — Node 24.2 is the verified floor the packed packages declare and CI exercises (the Router CLI relies on `import.meta.main`, added in Node 24.2.0; `.node-version` pins the 24.18 development line). The bootstrap command itself is a plain Node invocation, so the whole flow needs only Node and pnpm; the earlier Deno bootstrap was retired by the 2026-10-03 ADR-0161 amendment.

## Using element as a library

The scaffold is optional. A project that wants only the component runtime installs one package and never sees the Router:

```bash
pnpm add @openelement/element
```

- **Vite projects** mount the compiler through the package's Vite seam: `import { element } from '@openelement/compiler/vite'` and add `element()` to `plugins`. The plugin compiles each component's TSX `render()` into the Part Program at build time.
- **Other bundlers** drive the same compiler programmatically through `@openelement/compiler` — the TSX-to-Part-Program core the Vite plugin itself calls — and wire its output into their own pipeline.
- **The output is standard Custom Elements.** A compiled component is a plain class you register with `customElements.define`, so the emitted bundle loads in any page or framework with no runtime to vendor. This path is verified on every release: the packed-artifact consumer qualification installs `@openelement/element` alone (no Router, no scaffold), compiles a component, and loads the bundle from a separate plain-HTML page in three browsers.

## Explore

Read the [docs](/docs), [API reference](/reference), and [roadmap](/roadmap) as the current product map.

## Build

`pnpm build` produces the deployable site in `dist/` — prerendered HTML for every static route, everything under `public/` copied as-is, and, when the app has islands or request-time routes, the client chunks and the server entry beside it. That directory is the artifact: upload it to any static host, or point a Node/Workers deployment at `dist/server/index.js`.

Three scripts cover the loop:

```bash
pnpm build     # prerender into dist/ (+ dist/client, dist/server when needed)
pnpm start     # serve the real build, including request-time routes
pnpm preview   # static-only preview; refuses to run when dist/server exists
```

`pnpm start` is the one to check a change against, because it serves the same output production does and dispatches dynamic routes and form posts to the generated server entry. `pnpm preview` is deliberately narrower — it refuses a build that has a server side rather than silently hiding it, so it is only useful for an app with no request-time routes. Port comes from `OPEN_ELEMENT_PORT` (falling back to `PORT`, default 4173) and host from `OPEN_ELEMENT_HOST`.

Before shipping, `pnpm check` type-checks the app and `pnpm test` runs its tests; both are wired into the starter's scripts and need no extra setup. The full output contract — which files the build writes and what each one answers — is documented under [Deployment](/guide/deployment).

## See also

- [Core Concepts](/guide/core-concepts) — the component model behind the starter's files.
- [Routing and Data](/guide/routing-and-data) — pages, loaders and actions.
- [Deployment](/guide/deployment) — what `pnpm build` emits and how to verify it.
