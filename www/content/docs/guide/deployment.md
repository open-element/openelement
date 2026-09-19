---
title: 'Deployment'
lede: 'Deployment is built around generated static output and adapter-specific runtime boundaries.'
order: 100
---

## Build, start, preview

A generated project wires its Deno tasks to the router CLI subpaths:

```bash
deno task build     # SSG + request-time server into dist/
deno task start     # serve dist/; dynamic routes and mutations dispatch to dist/server
deno task preview   # static-only preview; refused when dist/server exists
deno task dev       # Vite dev server
```

`deno task start` serves `dist/` statically and, when `dist/server/index.js` exists, dispatches dynamic routes and mutations to it. Port comes from `OPEN_ELEMENT_PORT` (falling back to `PORT`, default 4173) and host from `OPEN_ELEMENT_HOST`. The same CLI with `--mode=preview` is static-only and refuses to run when `dist/server` exists, pointing at start mode instead — use it only for projects without request-time routes.

## Static output

`deno task build` writes the prerendered site into `dist/`:

- `dist/<route>/index.html` for every prerendered route, plus `dist/404.html` for the not-found route.
- Everything under `public/` copied as-is — favicon, `robots.txt`, images.
- `dist/client/` when the app has islands or enhanced forms: the shared entry `client.js` and one chunk per island tag under `dist/client/islands/`.
- `dist/island-manifests/page-<hash>.json`, one per page, listing each island's tag, chunk URL, strategy and layer — the built answer to "which JavaScript does this page load?".

A project with no islands, no enhanced forms, no actions and no `'dynamic'` routes is exactly this directory: upload it to any static host, and no server-side code is involved. Components that need no browser behavior are plain HTML in these files, so the prerendered output stays fully styled and readable without JavaScript.

## Request-time server

When any route declares `renderIntent: { mode: 'dynamic' }` or any page exports an action, the build also emits `dist/server/`:

- `index.js` — a portable `fetch(Request) -> Response` handler over the same SSR bundle.
- `server-manifest.json` — the request-time (`'dynamic'`) routes, with their paths, parameter names and action flags.
- `package.json` — marks the directory as ESM.

Hybrid pages (static GET + action) keep their prerendered artifact for GET; their POSTs reach the server by method dispatch. Pure-static builds emit none of these, and the output contract is frozen. Local preview is served by `deno task start`, which runs the same handler on `Deno.serve` — the only browser-independent way to exercise the request-time path before deploying.

## Nitro presets

Nitro is the first-party production deployment adapter, and the mount is a near pass-through over the fetch-native seam: the event's standard `Request` goes in, the handler's `Response` comes out. Add a route that forwards everything the static layer does not own:

```ts
// server/routes/[...path].ts
import { createOpenElementNitroHandler } from '@openelement/router/nitro-mount';
import openElementServer from '../../dist/server/index.js';

// Catch-all over the Nitro static layer (nitro-public/): prerendered files win,
// everything else — dynamic routes, actions, 404s — reaches the built handler.
export default createOpenElementNitroHandler({
  handler: (request, context) =>
    openElementServer({ req: request, env: (context?.env ?? {}) as Record<string, string> }),
});
```

```ts
// nitro.config.ts
export default defineNitroConfig({
  serverDir: 'server',
  preset: 'node-server', // or 'cloudflare_module' for Workers
  publicAssets: [{ dir: 'nitro-public' }],
});
```

The deploy sequence is:

1. `deno task build`
2. Copy everything in `dist/` **except** `server/` into `nitro-public/`. `dist/server` is server code, not a public asset, and must never be published as one.
3. Build the host: `deno run --allow-read --allow-write --allow-run --allow-env --allow-net npm:nitro@3.0.260610-beta build` — the version this repository's Nitro proofs pin (`NITRO_VERSION`); `preset` selects `node-server` or `cloudflare_module`.
4. Run the output (`.output/server/index.mjs` for `node-server`) with `PORT` and `HOST` set as your platform requires.

Both presets are proven against real Nitro output: prerendered files, dynamic routes, actions, redirects, 404s and a Nitro cache route rule.

## Dev server

`deno task dev` runs the Vite dev server; the router dev pipeline serves the generated Hono entry through `@hono/vite-dev-server`, so routes, loaders and actions execute in dev against the same generated entry the build prerenders and serves.

## Verification

Verify the artifact, not the log. After `deno task build`:

1. `ls dist/server/` tells you whether the build produced a request-time server at all. A pure-static project should show no `dist/server` directory.
2. `deno task start` prints which mode it loaded — `request-time server entry loaded (dynamic routes enabled)`, or `no dist/server — static-only preview`. That line is the artifact's own answer; if it disagrees with your routes, the build is what to look at.
3. `curl -i http://localhost:4173/` must answer 200 with the prerendered HTML for a static route.
4. `curl -i -X POST -H 'x-openelement-action: true' --data 'message=' http://localhost:4173/your-form-route` must reach the action: a validation failure answers `422` with `application/problem+json`, a success answers `303` with a `Location` header.
5. Request a `'dynamic'` route twice and confirm the response body differs from the file on disk in `dist/` — that is the request-time path working.

### Smoke script

Steps 3–4 as one copyable block (substitute your form route). It fails on the first wrong status, so it doubles as a deploy gate:

```bash
set -e
BASE=http://localhost:4173
test "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/")" = 200
test "$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  -H 'x-openelement-action: true' --data 'message=' \
  "$BASE/your-form-route")" = 422
echo 'artifact answers: static 200, action 422'
```

## See also

- [Build and configuration](/guide/configuration) — the build, routes and middleware options that shape the output.
- [Security](/guide/security) — what the generated handlers enforce at request time.
- [Testing](/guide/testing) — the checks worth running against a build.
