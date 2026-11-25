---
title: 'Deployment'
lede: 'Deployment is built around generated static output and adapter-specific runtime boundaries.'
order: 100
---

## Build, start, preview

A generated project wires its scripts to the router bin — `oe` (the short alias; `openelement` is the same dispatcher):

```bash
npm run build  # public snapshot and request-time output
npm start      # serve dist-public/; dynamic routes and mutations dispatch to dist/server
npm run dev    # Vite dev server
```

`npm start` serves `dist-public/` statically and, when `dist/server/index.js` exists, dispatches dynamic routes and mutations to it. Port comes from `OPEN_ELEMENT_PORT` (falling back to `PORT`, default 4173) and host from `OPEN_ELEMENT_HOST`. The same command with `--mode=preview` (`openelement start --mode=preview`) is static-only and refuses to run when `dist/server` exists, pointing at start mode instead — use it only for projects without request-time routes.

### Behind a proxy

The same-origin check that guards form posts compares the browser's `Origin` header against the origin of the request the server sees. A TLS-terminating proxy forwards plain HTTP, so the server's own guess is `http://…` while the browser's is `https://…`, and a perfectly legitimate same-origin POST is rejected as cross-site. Two environment variables state what the server cannot work out for itself:

- `OPEN_ELEMENT_PUBLIC_ORIGIN=https://example.com` — the origin the site is reachable at, as the browser sees it. This is the direct answer and the one to prefer.
- `OPEN_ELEMENT_TRUST_PROXY=1` — read `Forwarded` / `X-Forwarded-Proto` / `X-Forwarded-Host` from the incoming request. Set this **only** when nothing but your own proxy can reach the port: on a directly reachable server those headers are client input, and trusting them would let a caller choose the origin the check is made against.

With neither set, the origin stays `http://<Host>`, which is correct for a server that answers the internet itself.

## Static output

`npm run build` assembles `dist-public/` from prerendered pages, authored `public/` files, browser code and styles, and per-page island manifests. Asset URLs still use the `/client/` prefix.

`dist/publish-manifest.json` records each public file's relative path, size, SHA-256, and cache policy. Run `npx oe publish --check` before uploading `dist-public/` to a static host. Configure the host's directory index and error document rules for `index.html` and `404.html`. Deploy the request-time entry separately when the app uses dynamic routes or actions.

## Request-time server

When any route declares `renderIntent: { mode: 'dynamic' }` or any page exports an action, the build also emits `dist/server/`:

- `index.js` — a portable `fetch(Request) -> Response` handler over the same SSR bundle.
- `server-manifest.json` — the request-time (`'dynamic'`) routes, with their paths, parameter names and action flags.
- `package.json` — marks the directory as ESM.

Hybrid pages (static GET + action) keep their prerendered artifact for GET; their POSTs reach the server by method dispatch. Pure-static builds emit none of these, and the output contract is frozen. Local preview is served by `npm start` (the router `start` CLI), which runs the same handler on Node's `node:http` — the only browser-independent way to exercise the request-time path before deploying.

### Public file verification

`oe start` and static preview validate the complete public file list at startup. Static GET and HEAD resolve only manifest-listed files and verify each file's canonical path and contents. Keep the build workspace `dist/` and its request-time entry under `dist/server/` in the application environment. The first public path segment `server` is reserved.

## Nitro presets

Nitro is the first-party production deployment adapter, and the mount is a near pass-through over the fetch-native seam: the event's standard `Request` goes in, the handler's `Response` comes out. Add a route that forwards everything the static layer does not own:

```ts
// server/routes/[...path].ts
import { createOpenElementNitroHandler } from '@openelement/router/nitro-mount';
import openElementServer from '../../dist/server/index.js';

// Catch-all over the Nitro static layer (dist-public/): prerendered files win,
// everything else — dynamic routes, actions, 404s — reaches the built handler.
export default createOpenElementNitroHandler({
  handler: (request, context) =>
    openElementServer({ req: request, env: (context?.env ?? {}) as Record<string, string> }),
});
```

```ts
// nitro.config.ts
import { fileURLToPath } from 'node:url';

const publicDir = fileURLToPath(new URL('./dist-public', import.meta.url));

export default defineNitroConfig({
  serverDir: 'server',
  preset: 'node-server', // or 'cloudflare_module' for Workers
  publicAssets: [{ dir: publicDir }],
  modules: [
    ({ options }) => {
      options.publicAssets = options.publicAssets.filter(({ dir }) => dir === publicDir);
    },
  ],
});
```

The Nitro module keeps asset discovery scoped to the verified build directory.

The deploy sequence is:

1. `npm run build`
2. Run `npx oe publish --check`. Nitro packages the verified `dist-public/` directory as public assets.
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
