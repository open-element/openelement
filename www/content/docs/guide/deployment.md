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

### Private `dist/server` boundary

`npm start` (`oe start`) serves `dist/` as public output, and the build's private artifacts are outside the namespace it will ever serve. A GET or HEAD whose decoded, normalized path starts with `server/` — `/server/index.js`, `/Server/index.js`, `/%73erver/index.js`, `//server/index.js`, `/foo/../server/index.js` — answers `404`, and so does a request through an in-root symlink whose canonical target resolves inside `dist/server/`. The refusal reads nothing under `dist/server/` and answers a bare `404`; the request-time server is not consulted for it. The same shared static boundary answers `start` and `--mode=preview`, so there is no serving mode that publishes these artifacts.

The first path segment is reserved: an author's own `public/server/` files are not published either, so keep public assets out of that name. Ordinary static output — pages, `client/` assets, `island-manifests/`, other `public/` copies — is unaffected, and the build never publishes `dist/server` through the static boundary.

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
2. Copy everything in `dist/` **except** `server/` into `nitro-public/`. `dist/server` is server code, not a public asset, and must never be published as one. (`npm start` enforces the same rule at its static boundary, above; for Nitro the copy step is what keeps the directory out of the host's static layer.)
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
4. `curl -i http://localhost:4173/server/index.js` must answer `404` (not the generated entry): the private artifacts are not part of the public output.
5. `curl -i -X POST -H 'x-openelement-action: true' --data 'message=' http://localhost:4173/your-form-route` must reach the action. The header selects the FETCH channel, whose answers are data rather than navigations — measured on this build:

   | channel | invalid submission | valid submission |
   | --- | --- | --- |
   | native form (no header) | `422`, the re-rendered form | `303` with a `Location` header |
   | fetch (`x-openelement-action: true`) | `422`, `application/json`, body `{"type":"failure","status":422,"data":{…}}` | `200` (not 303), `application/json`, body `{"type":"redirect","status":303,"location":"…"}` |

   The PRG status rides inside the fetch channel's body because that answer is data, not a redirect to follow. `application/problem+json` is the channel's PROTOCOL-error shape (a rejected cross-site post, an unknown action, an unparseable body), not the shape a validation failure uses.
6. Request a `'dynamic'` route twice and confirm the response body differs from the file on disk in `dist/` — that is the request-time path working.

### Smoke script

Steps 3–5 as one copyable block (substitute your form route). It fails on the first wrong status, so it doubles as a deploy gate:

```bash
set -e
BASE=http://localhost:4173
test "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/")" = 200
test "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/server/index.js")" = 404
test "$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  -H 'x-openelement-action: true' --data 'message=' \
  "$BASE/your-form-route")" = 422
echo 'artifact answers: static 200, private 404, action 422'
```

## Artifact compatibility

Deploy the complete output of one `npm run build`. Update prerendered HTML, browser assets and the request-time server entry together. Give a static host only the public output, and keep server modules and their manifest in the application environment.

## See also

- [Build and configuration](/guide/configuration) — the build, routes and middleware options that shape the output.
- [Security](/guide/security) — what the generated handlers enforce at request time.
- [Testing](/guide/testing) — the checks worth running against a build.
