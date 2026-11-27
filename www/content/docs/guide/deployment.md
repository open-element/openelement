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

### Pure static: Cloudflare Pages

In the starter, `app/routes/404.tsx` starts with `renderIntent: { mode: 'dynamic' }`. Remove that option to prerender `404.html`. If your app has no other dynamic routes or actions, the build is static-only and the complete Pages upload is `dist-public/`.

```bash
set -e
npm run build
npx oe publish --check
test -f dist-public/404.html
npx wrangler pages deploy dist-public --project-name=your-project
```

For a Git-integrated Pages project, set its output directory to `dist-public` and include `npx oe publish --check` in the build command. [Cloudflare Pages uses a top-level `404.html` for unmatched paths](https://developers.cloudflare.com/pages/configuration/serving-pages/#not-found-behavior). After deployment, verify the homepage returns 200 and an unknown path returns 404 at the Pages origin.

## Request-time server

When any route declares `renderIntent: { mode: 'dynamic' }` or any page exports an action, the build also emits `dist/server/`:

- `index.js` — the request-time entry over the same SSR bundle. Its default export accepts a Nitro request event and returns a `Response`.
- `server-manifest.json` — the request-time (`'dynamic'`) routes, with their paths, parameter names and action flags.
- `package.json` — marks the directory as ESM.

Hybrid pages (static GET + action) keep their prerendered artifact for GET; their POSTs reach the server by method dispatch. Pure-static builds omit `dist/server/`. Run `npm start` to exercise the request-time entry locally before packaging it for your host.

### Public file verification

`oe start` and static preview validate the complete public file list at startup. Static GET and HEAD resolve only manifest-listed files and verify each file's canonical path and contents. Keep the build workspace `dist/` and its request-time entry under `dist/server/` in the application environment. The first public path segment `server` is reserved.

## Nitro presets

Nitro receives the generated request-time entry and the verified public directory from the same build. The catch-all receives Nitro's fetch-native request event. Prerendered files serve static GETs, and dynamic routes, actions and request-time 404s reach the generated handler.

```ts
// server/routes/[...path].ts
export { default } from '../../dist/server/index.js';
```

```ts
// nitro.config.ts
import { fileURLToPath } from 'node:url';

const publicDir = fileURLToPath(new URL('./dist-public', import.meta.url));

export default defineNitroConfig({
  serverDir: 'server',
  publicAssets: [{ dir: publicDir }],
  modules: [
    ({ options }) => {
      options.publicAssets = options.publicAssets.filter(({ dir }) => dir === publicDir);
    },
  ],
  compatibilityDate: '2026-06-12',
  cloudflare: { nodeCompat: true },
});
```

The Nitro module limits static asset discovery to `dist-public/`. Both presets use this configuration.

```bash
npm run build
npx oe publish --check
```

### Node server

```bash
npx nitro@3.0.260610-beta build --preset=node-server
HOST=127.0.0.1 PORT=4173 node .output/server/index.mjs
```

Use the local origin for the smoke script below. Set `HOST` and `PORT` for your platform when deploying the Node artifact.

### Request-time routes: Workers through Nitro

```bash
npx nitro@3.0.260610-beta build --preset=cloudflare_module
```

Nitro writes the Worker module to `.output/server/index.mjs`, verified static files to `.output/public/`, and the generated Wrangler config to `.output/server/wrangler.json`. Check that the config enables Node.js compatibility and points `ASSETS` at the packaged public directory. The generated Router entry reads Workers bindings from Nitro's request and makes them available as `ctx.env` in loaders and actions.

With access to the intended Cloudflare account, deploy the verified artifact from the project root with `npx nitro@3.0.260610-beta deploy --prebuilt`. Run the smoke script using the deployed origin. Also confirm a request-time loader can read an expected binding without returning its value. The repository fixture exercises Nitro output locally using a loopback Node server and the generated Worker module with local bindings.

## Dev server

`npm run dev` runs the Vite dev server; the router dev pipeline serves the generated Hono entry through `@hono/vite-dev-server`, so routes, loaders and actions execute in dev against the same generated entry the build prerenders and serves.

## Verification

Check the HTTP responses after building and starting the application.

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
6. Request a dynamic route with two different inputs that its loader reads. Check that each response contains its own value and has `Cache-Control: private, no-cache`.

### Smoke script

Set `BASE` to the local or deployed origin and `FORM_PATH` to a route that rejects an empty message with 422. Each status check must pass before the script prints its result.

```bash
set -e
BASE=http://localhost:4173
FORM_PATH=/your-form-route
test "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/")" = 200
test "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/server/index.js")" = 404
test "$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  -H "Origin: $BASE" -H 'x-openelement-action: true' --data 'message=' \
  "$BASE$FORM_PATH")" = 422
echo 'artifact answers: static 200, private 404, action 422'
```

## Artifact compatibility

Deploy the complete output of one `npm run build`. Update prerendered HTML, browser assets and the request-time server entry together. Give a static host only the public output, and keep server modules and their manifest in the application environment.

## See also

- [Build and configuration](/guide/configuration) — the build, routes and middleware options that shape the output.
- [Form actions](/guide/recipe-form-actions) — form validation, native redirects, and enhancement.
- [Security](/guide/security) — what the generated handlers enforce at request time.
- [Testing](/guide/testing) — the checks worth running against a build.
