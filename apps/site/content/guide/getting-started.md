---
title: 'Getting Started'
lede: 'OpenElement is a Web Components-native, static-first application framework. Start with standard Custom Elements, pages, routes, selective upgrades and deployable Vite/Nitro output.'
order: 1
---

> The current source line is `{{OPENELEMENT_VERSION}}`, a public prerelease published under dist-tag `beta`; npm `latest` remains the stable 0.43 line, carrying the ADR-0119 static freeze, the ADR-0122 application-loop freeze and the 0.43 Universal WC SSR contract.

## Install

Three commands to a running app:

```bash
deno run -A --minimum-dependency-age 0 npm:@openelement/create my-app
cd my-app
deno task dev
```

The default dist-tag is the stable 0.43 line. `--minimum-dependency-age 0` keeps the bootstrap usable during the first day after a compatible patch is published, when Deno's default `minimumDependencyAge` would otherwise refuse it.

> Deno 2.8+ is required — the generated starter writes the `minimumDependencyAge` config key, which older Deno versions do not understand.

## Explore

Read the [docs](/docs), [API reference](/apilist), and [roadmap](/roadmap) as the current product map.

## Build

Run build, package, docs truth, and visual smoke gates before release.
