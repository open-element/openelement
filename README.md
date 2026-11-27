<p align="center">
  <img src="./www/public/favicon.svg" alt="openElement logo" width="64" height="64" />
</p>

# OpenElement

<p align="center">
  <a href="https://www.bestpractices.dev/projects/16052"><img src="https://www.bestpractices.dev/projects/16052/badge" alt="OpenSSF Best Practices: passing" /></a>
  <img src="https://img.shields.io/npm/v/%40openelement%2Frouter" alt="npm version" />
  <img src="https://badgen.net/npm/dm/%40openelement%2Felement" alt="npm monthly downloads" />
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="license: MIT" />
  <img src="https://img.shields.io/badge/node-%3E%3D24.2-informational" alt="node: >=24.2" />
</p>

English | [简体中文](./README.zh.md)

OpenElement is a framework for server-rendered HTML and interactive Custom Elements. **Compiler** turns TSX into Custom Elements and server renderers. **Element** provides the runtime. **Router** handles routes, navigation, loaders and actions.

## Start with npm

Use Node.js 24.2 or newer. The default command uses the npm `latest` tag, which currently serves an alpha release.

```sh
npm create @openelement my-app
cd my-app
npm run dev
```

Open the URL printed by the dev server. Edit `app/routes/index.tsx` to change the home page. Stop the server before running `npm test` and `npm run build`.

To select the alpha channel explicitly, run `npm create @openelement@alpha my-app` in place of the first command. Check both tags with `npm view @openelement/create dist-tags`. The [changelog](./CHANGELOG.md) lists how to install Alpha16 once it is published.

Follow the [first app tutorial](https://openelement.org/guide/tutorial/) to add a page, an interactive island, and a form action. See the [deployment guide](https://openelement.org/guide/deployment/) for static hosting, Node, and Cloudflare Workers.

## Preview the source checkout

This checkout previews `1.0.0-alpha.16` with JSX and TSX function components for server-rendered pages and interactive islands. The setup task builds the packages from this checkout and installs them into a temporary starter app. [Release state](./docs/release/release-state.json)

```sh
pnpm install --frozen-lockfile
export STARTER_SMOKE_WORK_DIR="$(mktemp -d)"
pnpm exec vp run --no-cache --fail-if-no-match --filter @openelement/e2e-starter-smoke setup
cd "$STARTER_SMOKE_WORK_DIR/my-blog"
pnpm run dev
```

Edit `app/routes/index.tsx` to try the starter's file routing. Run `pnpm test` and `pnpm run build` after stopping the dev server. [Starter package](./packages/create/README.md)

## Repository

| Directory | What lives here |
| --- | --- |
| [packages](./packages) | [Element runtime](./packages/element), [compiler](./packages/compiler), [protocol contracts](./packages/protocol), [Router](./packages/router), [starter CLI](./packages/create), and [experimental UI](./packages/ui) |
| [tests](./tests) | Cross-package tests, starter smoke and deployment fixtures |
| [tools](./tools) | Repository checks, release packaging and packed consumer tests |
| [docs](./docs/architecture/README.md) | Current architecture and [decisions](./docs/adr/README.md) |
| [www](./www) | Official documentation site and its browser tests |
| [apps/saas](./apps/saas) | Separately governed first-party consumer app |

Read the [website](https://openelement.org) or [contributor guide](./CONTRIBUTING.md). For security reports, follow the [security policy](./SECURITY.md). [MIT license](./LICENSE)
