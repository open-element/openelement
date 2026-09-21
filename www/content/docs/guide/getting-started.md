---
title: 'Getting Started'
lede: 'OpenElement is a Web Components-native, static-first application framework. Start with standard Custom Elements, pages, routes, selective upgrades and deployable Vite/Nitro output.'
order: 1
---

> {{SOURCE_LINE_NOTE}} Registry truth lives in [`docs/release/release-state.json`](https://github.com/open-element/openelement/blob/main/docs/release/release-state.json) — there is no supported migration from 0.x.

## Install

Three commands to a running app:

```bash
{{INSTALL_COMMAND}}
cd my-app
deno task dev
```

The version the install command resolves is registered in [`docs/release/release-state.json`](https://github.com/open-element/openelement/blob/main/docs/release/release-state.json), the repository's registry-verified source of truth; `--minimum-dependency-age 0` keeps the bootstrap installable during the first day after a compatible patch ships.

> Deno 2.9+ is required: it is the verified floor this repository pins and exercises in CI.

## Explore

Read the [docs](/docs), [API reference](/reference), and [roadmap](/roadmap) as the current product map.

## Build

`deno task build` produces the deployable site in `dist/` — prerendered HTML for every static route, everything under `public/` copied as-is, and, when the app has islands or request-time routes, the client chunks and the server entry beside it. That directory is the artifact: upload it to any static host, or point a Node/Workers deployment at `dist/server/index.js`.

Three tasks cover the loop:

```bash
deno task build     # prerender into dist/ (+ dist/client, dist/server when needed)
deno task start     # serve the real build, including request-time routes
deno task preview   # static-only preview; refuses to run when dist/server exists
```

`deno task start` is the one to check a change against, because it serves the same output production does and dispatches dynamic routes and form posts to the generated server entry. `deno task preview` is deliberately narrower — it refuses a build that has a server side rather than silently hiding it, so it is only useful for an app with no request-time routes. Port comes from `OPEN_ELEMENT_PORT` (falling back to `PORT`, default 4173) and host from `OPEN_ELEMENT_HOST`.

Before shipping, `deno task check` type-checks the app and `deno task test` runs its tests; both are wired into the starter's tasks and need no extra setup. The full output contract — which files the build writes and what each one answers — is documented under [Deployment](/guide/deployment).

## See also

- [Core Concepts](/guide/core-concepts) — the component model behind the starter's files.
- [Routing and Data](/guide/routing-and-data) — pages, loaders and actions.
- [Deployment](/guide/deployment) — what `deno task build` emits and how to verify it.
