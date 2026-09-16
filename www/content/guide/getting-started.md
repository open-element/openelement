---
title: 'Getting Started'
lede: 'OpenElement is a Web Components-native, static-first application framework. Start with standard Custom Elements, pages, routes, selective upgrades and deployable Vite/Nitro output.'
order: 1
---

> `1.0.0-alpha.1` is the new baseline for Element and Router. There is no supported migration from 0.x — start new projects from `@openelement/create`.

## Install

Three commands to a running app:

```bash
deno run --allow-read --allow-write --allow-env --allow-net --deny-ffi --no-prompt --minimum-dependency-age 0 npm:@openelement/create@alpha my-app
cd my-app
deno task dev
```

The published npm versions and dist-tags of the `@openelement/*` packages — including the version the install command above resolves — are registered in `docs/release/release-state.json`, the repository's registry-verified source of truth. `--minimum-dependency-age 0` keeps the bootstrap usable during the first day after a compatible patch is published, when Deno's default `minimumDependencyAge` would otherwise refuse it.

> Deno 2.9+ is required (the Alpha baseline is verified on Deno 2.9). The generated starter writes the `minimumDependencyAge` config key, which older Deno versions do not understand.

## Explore

Read the [docs](/docs), [API reference](/apilist), and [roadmap](/roadmap) as the current product map.

## Build

Run build, package, docs truth, and visual smoke gates before release.
