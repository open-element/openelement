---
title: 'Deploy to Cloudflare'
lede: 'One build decision picks the Cloudflare target: a pure-static `dist/` uploads to Pages as files, request-time routes deploy to Workers through the Nitro mount.'
order: 101
---

`pnpm build` decides the target for you. When it emits no `dist/server/`, the output is a plain file tree — upload it to Cloudflare Pages and no server code is involved. When any route stays request-time (a `'dynamic'` route or an action), the build also emits `dist/server/index.js`: the same `fetch(Request) -> Response` handler that `pnpm start` runs locally. That is the whole server contract — one handler, deployable to any fetch-native host — so moving from Pages to Workers is a host decision, not a rewrite.

## Pure static: Cloudflare Pages

The starter ships its 404 route on the request-time path:

```ts
// app/routes/404.tsx — starter default
export default definePage(NotFoundPage, {
  renderIntent: { mode: "dynamic" },
  head: { title: "404 — openElement" },
});
```

That one line is why a starter build emits `dist/server/`: the request-time server renders the page with a real 404 status for unmatched paths, so no static 404 file is written. Delete the `renderIntent` line and the route becomes prerenderable — a build with no other request-time route then produces a pure-static `dist/`:

```bash
pnpm build
ls dist/
# 404.html  assets/  index.html
```

The build itself confirms the mode (`Pure-static build: removed build-time SSR bundle (dist/server)`), and no `dist/server/` directory exists to leak server code into the upload. Upload the directory as a Pages project:

```bash
npx wrangler pages deploy dist
```

The first deploy creates the project (name it with `--project-name` or let the CLI prompt); later deploys upload new files and the site updates. Pages' static-asset convention serves a top-level `404.html` — with its 404 status — for any path that matches no file, so the styled prerendered 404 is the site's not-found page with zero server code.

Verify the artifact, not the log (substitute your pages.dev host):

```bash
BASE=https://your-project.pages.dev
test "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/")" = 200
test "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/no-such-page")" = 404
echo 'Pages artifact answers: home 200, miss 404'
```

## Request-time routes: Workers through Nitro

When `pnpm build` emits `dist/server/`, deploy the built handler to Cloudflare Workers behind a two-file Nitro host. The mount (`@openelement/router/nitro-mount`) is a near pass-through over the fetch-native seam: the event's standard `Request` goes in, the handler's `Response` comes out.

```ts
// server/routes/[...path].ts
import { createOpenElementNitroHandler } from '@openelement/router/nitro-mount';
import openElementServer from '../../dist/server/index.js';

// Catch-all over the Nitro static layer (nitro-public/): prerendered files
// win, everything else — dynamic routes, actions, 404s — reaches the built
// handler.
export default createOpenElementNitroHandler({
  handler: (request, context) =>
    openElementServer({
      req: request,
      env: (context?.env ?? {}) as Record<string, string>,
    }),
});
```

```ts
// nitro.config.ts
export default defineNitroConfig({
  serverDir: 'server',
  publicAssets: [{ dir: 'nitro-public' }],
  compatibilityDate: '2026-06-12',
  cloudflare: { nodeCompat: true },
});
```

The `env` forwarding is what carries Workers bindings into your loaders and actions. On Workers, h3 v2 delivers bindings on the request itself (`req.runtime.cloudflare.env`) — the h3 event has no `env` field — and the mount resolves that runtime channel first, then an explicit `event.env`, then mount options. Forwarding `context.env` as above means `ctx.env` in a loader or action reads your Workers bindings directly.

The deploy sequence:

1. `pnpm build`
2. Publish the prerendered tree for Nitro's static layer. `dist/server/` is server code, not a public asset, and must never be published as one:

   ```bash
   mkdir -p nitro-public
   cp -R dist/. nitro-public/
   rm -rf nitro-public/server
   ```

3. Build the Workers output with the Nitro version this repository pins for compatibility (tools/release/nitro-compatibility.ts):

   ```bash
   npx nitro@3.0.260610-beta build --preset=cloudflare_module
   ```

4. Deploy `.output/`. Nitro emits `server/index.mjs` — a Workers module exporting `default fetch(request, env, context)` — plus `public/` and a generated `server/wrangler.json` (compatibility date, `nodejs_compat`, and the `ASSETS` binding pointed at `public/`). Deploy from the project root with `npx nitro deploy --prebuilt`, or from `.output/` with the wrangler command the generated `nitro.json` records (`npx wrangler --cwd ./ deploy`).

Before deploying, prove the wiring on a host you can curl: the same two files build unmodified with `--preset=node-server`, and the `.output/server/index.mjs` entry boots under Node with `PORT` and `HOST` set — `curl` the static home (served from the static layer), a `'dynamic'` route (rendered by `dist/server` through the mount), and an unmatched path (the styled 404 with a real 404 status). Static files winning over the catch-all is the expected behavior, and it is also why `dist/server` must stay out of `nitro-public/`.

Bindings are worth one explicit check: give the Worker a test binding and read it in a loader via `ctx.env`. If it shows up, the whole channel works — Workers env → `req.runtime.cloudflare.env` → mount → `dist/server` → `ctx.env`.

## See also

- [Deployment](/guide/deployment) — the build output contract, local start/preview, and the Node host.
- [Routing and data](/guide/routing-and-data) — `renderIntent`, loaders and actions.
- [Security](/guide/security) — what the generated handler enforces at request time.
