---
title: 'Getting Started'
lede: 'OpenElement is a Web Components-native, static-first application framework. Start with standard Custom Elements, pages, routes, selective upgrades and deployable Vite/Nitro output.'
order: 1
---

> {{SOURCE_LINE_NOTE}} Registry truth lives in [`docs/release/release-state.json`](https://github.com/open-element/openelement/blob/main/docs/release/release-state.json) — there is no supported migration from 0.x.

## Install

Three commands to a running app:

```bash
deno run --allow-read --allow-write --allow-env --allow-net --deny-ffi --no-prompt --minimum-dependency-age 0 npm:@openelement/create@alpha my-app
cd my-app
deno task dev
```

The version the install command resolves is registered in [`docs/release/release-state.json`](https://github.com/open-element/openelement/blob/main/docs/release/release-state.json), the repository's registry-verified source of truth; `--minimum-dependency-age 0` keeps the bootstrap installable during the first day after a compatible patch ships.

> Deno 2.9+ is required: it is the verified floor this repository pins and exercises in CI.

## Explore

Read the [docs](/docs), [API reference](/reference), and [roadmap](/roadmap) as the current product map.

## Build

Run build, package, docs truth, and visual smoke gates before release.

## See also

- [Core Concepts](/guide/core-concepts) — the component model behind the starter's files.
- [Routing and Data](/guide/routing-and-data) — pages, loaders and actions.
- [Deployment](/guide/deployment) — what `deno task build` emits and how to verify it.
