---
title: 'Deployment'
lede: 'Deployment is built around generated static output and adapter-specific runtime boundaries.'
order: 100
---

## Build, start, preview

A generated project wires its Deno tasks to the adapter CLI subpaths: `deno task build` runs `@openelement/adapter-vite/cli/build`; `deno task start` runs `cli/start` — one command that serves `dist/` statically and, when `dist/server/index.js` exists, dispatches dynamic routes and mutations to it (port `OPEN_ELEMENT_PORT` or `PORT`, default 4173; host `OPEN_ELEMENT_HOST`). The same command with `--mode=preview` is static-only and refuses to run when `dist/server` exists, pointing at start mode instead.

## Static output

The docs site is generated through the SSG pipeline.

## Request-time server

When any route declares `renderIntent: { mode: 'dynamic' }`, the build also emits `dist/server/index.js` — a Nitro-mountable handler over the same SSR bundle — plus `server-manifest.json` listing the request-time routes, and `dist/server/serve.mjs`, a standalone production entry (`node dist/server/serve.mjs`; Node 24+, Deno, Bun) that serves the static tree and dispatches request-time routes without the CLI. Pure-static builds emit none of these; this output contract is frozen under ADR-0122.

## Nitro presets

Nitro is the first-party production deployment adapter. Bridge the built handler into a Nitro v3 event with `createOpenElementNitroHandler` from `@openelement/adapter-vite/nitro-mount` — a near pass-through over the fetch-native seam: the event's standard `Request` (`event.req`) goes in, the handler's `Response` comes out; both supported presets — `node-server` and `cloudflare_module` (Workers) — are proven against real Nitro output by the `deno task nitro:proof:node` / `nitro:proof:workers` gates.

## Dev server

`deno task dev` runs the Vite dev server; the adapter serves the generated Hono entry through `@hono/vite-dev-server`, so routes, loaders and actions execute in dev against the same generated entry the build prerenders and serves.

## Verification

Build output should be checked before publishing or pushing release changes.
