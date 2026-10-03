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

The version the install command resolves is registered in [`docs/release/release-state.json`](https://github.com/open-element/openelement/blob/main/docs/release/release-state.json), the repository's registry-verified source of truth; `--minimum-dependency-age 0` keeps the bootstrap installable during the first day after a compatible patch ships.

> The generated project is a plain Node/pnpm app (ADR-0161): Node.js 24.2+ and pnpm run its scripts — Node 24.2 is the verified floor the packed packages declare and CI exercises (the Router CLI relies on `import.meta.main`, added in Node 24.2.0; `.node-version` pins the 24.18 development line). The bootstrap command itself is a Deno invocation: Deno 2.9+ is the verified floor for that one command, resolving the packages through `npm:` specifiers.

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
