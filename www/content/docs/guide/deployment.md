---
title: 'Deployment'
lede: 'Deployment is built around generated static output and adapter-specific runtime boundaries.'
order: 100
---

## Build, start, preview

A generated project wires its scripts to the router bin — `oe` (the short alias; `openelement` is the same dispatcher):

```bash
npm run build  # SSG + request-time server into dist/
npm start      # serve dist/; dynamic routes and mutations dispatch to dist/server
npm run dev    # Vite dev server
```

`npm start` serves `dist/` statically and, when `dist/server/index.js` exists, dispatches dynamic routes and mutations to it. Port comes from `OPEN_ELEMENT_PORT` (falling back to `PORT`, default 4173) and host from `OPEN_ELEMENT_HOST`. The same command with `--mode=preview` (`openelement start --mode=preview`) is static-only and refuses to run when `dist/server` exists, pointing at start mode instead — use it only for projects without request-time routes.

### Behind a proxy

The same-origin check that guards form posts compares the browser's `Origin` header against the origin of the request the server sees. A TLS-terminating proxy forwards plain HTTP, so the server's own guess is `http://…` while the browser's is `https://…`, and a perfectly legitimate same-origin POST is rejected as cross-site. Two environment variables state what the server cannot work out for itself:

- `OPEN_ELEMENT_PUBLIC_ORIGIN=https://example.com` — the origin the site is reachable at, as the browser sees it. This is the direct answer and the one to prefer.
- `OPEN_ELEMENT_TRUST_PROXY=1` — read `Forwarded` / `X-Forwarded-Proto` / `X-Forwarded-Host` from the incoming request. Set this **only** when nothing but your own proxy can reach the port: on a directly reachable server those headers are client input, and trusting them would let a caller choose the origin the check is made against.

With neither set, the origin stays `http://<Host>`, which is correct for a server that answers the internet itself.

## Static output

`npm run build` writes the prerendered site into `dist/`:

- `dist/<route>/index.html` for every prerendered route. A not-found route marked `renderIntent: { mode: 'dynamic' }` is served by the request-time server instead (with a real 404 status); a prerenderable one is written to `dist/404.html`.
- Everything under `public/` copied as-is — favicon, `robots.txt`, images.
- `dist/client/` when the app has islands or enhanced forms: the shared entry `client.js` and one chunk per island tag under `dist/client/islands/`.
- `dist/island-manifests/page-<hash>.json`, one per page, listing each island's tag, chunk URL, strategy and layer — the built answer to "which JavaScript does this page load?".

A project with no islands, no enhanced forms, no actions and no `'dynamic'` routes is exactly this directory: upload it to any static host, and no server-side code is involved. Components that need no browser behavior are plain HTML in these files, so the prerendered output stays fully styled and readable without JavaScript.

## Request-time server

When any route declares `renderIntent: { mode: 'dynamic' }` or any page exports an action, the build also emits `dist/server/`:

- `index.js` — a portable `fetch(Request) -> Response` handler over the same SSR bundle.
- `server-manifest.json` — the request-time (`'dynamic'`) routes, with their paths, parameter names and action flags.
- `package.json` — marks the directory as ESM.

Hybrid pages (static GET + action) keep their prerendered artifact for GET; their POSTs reach the server by method dispatch. Pure-static builds emit none of these, and the output contract is frozen. Local preview is served by `npm start` (the router `start` CLI), which runs the same handler on Node's `node:http` — the only browser-independent way to exercise the request-time path before deploying.

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

1. `npm run build`
2. Copy everything in `dist/` **except** `server/` into `nitro-public/`. `dist/server` is server code, not a public asset, and must never be published as one.
3. Build the host: `npx nitro@3.0.260610-beta build` — the version this repository's Nitro proofs pin (`NITRO_VERSION`); `preset` selects `node-server` or `cloudflare_module`.
4. Run the output (`.output/server/index.mjs` for `node-server`) with `PORT` and `HOST` set as your platform requires.

Both presets are proven against real Nitro output: prerendered files, dynamic routes, actions, redirects, 404s and a Nitro cache route rule.

## Dev server

`npm run dev` runs the Vite dev server; the router dev pipeline serves the generated Hono entry through `@hono/vite-dev-server`, so routes, loaders and actions execute in dev against the same generated entry the build prerenders and serves.

## Verification

Verify the artifact, not the log. After `npm run build`:

1. `ls dist/server/` tells you whether the build produced a request-time server at all. A pure-static project should show no `dist/server` directory.
2. `npm start` prints which mode it loaded — `request-time server entry loaded (dynamic routes enabled)`, or `no dist/server — static-only preview`. That line is the artifact's own answer; if it disagrees with your routes, the build is what to look at.
3. `curl -i http://localhost:4173/` must answer 200 with the prerendered HTML for a static route.
4. `curl -i -X POST -H 'x-openelement-action: true' --data 'message=' http://localhost:4173/your-form-route` must reach the action. The header selects the FETCH channel, whose answers are data rather than navigations — measured on this build:

   | channel | invalid submission | valid submission |
   | --- | --- | --- |
   | native form (no header) | `422`, the re-rendered form | `303` with a `Location` header |
   | fetch (`x-openelement-action: true`) | `422`, `application/json`, body `{"type":"failure","status":422,"data":{…}}` | `200` (not 303), `application/json`, body `{"type":"redirect","status":303,"location":"…"}` |

   The PRG status rides inside the fetch channel's body because that answer is data, not a redirect to follow. `application/problem+json` is the channel's PROTOCOL-error shape (a rejected cross-site post, an unknown action, an unparseable body), not the shape a validation failure uses.
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

## Artifact compatibility

Generated modules carry two version stamps in their header banner: the Part Program format version and the generated-module ABI version. A runtime refuses an artifact whose version it does not implement — validation fails closed with an expected-vs-actual diagnostic (`version must be 2 (got 1) … v1 artifacts are refused, never coerced`) rather than reading the artifact under the wrong grammar.

Deploy one build. The version check catches an artifact compiled against a different format version than the runtime executing it, but it cannot tell two builds of the *same* version apart: mixing browser assets from one build with a request-time server entry from another is neither supported nor detected. Regenerate the whole output (`npm run build`) and ship `dist/` as one unit.

## See also

- [Build and configuration](/guide/configuration) — the build, routes and middleware options that shape the output.
- [Security](/guide/security) — what the generated handlers enforce at request time.
- [Testing](/guide/testing) — the checks worth running against a build.
