# OpenElement

English | [简体中文](./README.zh.md)

OpenElement is a Web Components-native, static-first application framework.
Standard Custom Elements are the durable component contract; JSX is the
authoring syntax; Declarative Shadow DOM is the default server representation;
and interactive regions activate selectively.

The published stable line remains the 0.43 series on npm `latest`.
`v0.44.0-beta.2.1` is the current public v0.44 prerelease — Beta.2.1,
Router foundation and independent Element (ADR-0152) — published under dist-tag
`beta`. The accepted next work is Beta.2.2–Beta.2.3 convergence, followed by public
`v1.0.0-alpha.1` after admission ([roadmap](docs/roadmap/ROADMAP.md)).
The `1.0.0` target remains unscheduled and requires separate evidence and approval.

```text
OpenElement = Web Components-native fullstack application framework
current proven scope = static-first applications with fullstack output paths
```

Source package line: `0.44.0-beta.2.1` (`v0.44.0-beta.2.1`).
npm registry line: `v0.44.0-beta.2.1` (prerelease, dist-tag `beta`); npm `latest` remains the stable `0.43.3` line.

The accepted core products are **Element / Router**, with Route Mode
and Framework Mode sharing one Router core. UI is dogfood and a reference
implementation, not a third core product. [Product boundaries](docs/architecture/product-model.md)
and [the active plan](docs/current/VERSION_PLAN.md) distinguish planned convergence
from the currently shipped package surface.

## Why

OpenElement lets one Custom Element contract work in a standalone library and
in a full application. It combines element authoring, routing, static
generation, server rendering, existing-DOM claim, selective activation, and
deployable output without making a framework-specific virtual DOM the public
component model.

## Quick start

```sh
deno run -A --minimum-dependency-age 0 npm:@openelement/create my-app
cd my-app
deno task dev
```

The repository pins its supported Deno version in `.dvmrc`.

## Features

- `OpenElement extends HTMLElement` as the component foundation
- five coherent packages: `element`, `app`, `adapter-vite`, `create`, and `ui`
- Vite and Nitro as the supported build and server path
- static generation, request-time rendering, Declarative Shadow DOM, and claim
- standards-based output for Deno, Node, Bun, browsers, and edge runtimes
- npm packages with provenance-oriented release controls

## Docs

- [Getting started](https://openelement.org/guide/getting-started)
- [Current architecture](./docs/architecture/README.md)
- [Current status](./docs/status/STATUS.md)
- [Roadmap](./docs/roadmap/ROADMAP.md)
- [Version plan](./docs/current/VERSION_PLAN.md)
- [Security policy](./SECURITY.md)

## Community

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request. Use
[GitHub Discussions](https://github.com/open-element/openelement/discussions)
for questions and design discussion. Report vulnerabilities privately as
described in [SECURITY.md](./SECURITY.md).

OpenElement is available under the MIT license.

Repository workflow: [PROJECT_WORKFLOW.md](./docs/governance/PROJECT_WORKFLOW.md).
