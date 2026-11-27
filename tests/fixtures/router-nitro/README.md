# Router on Nitro

Run from the repository root after the frozen workspace install.

```sh
vp run --no-cache --fail-if-no-match --filter @openelement/fixture-router-nitro proof:node
vp run --no-cache --fail-if-no-match --filter @openelement/fixture-router-nitro proof:workers
```

Each command builds the request-time Router fixture, builds a pinned Nitro
preset, and checks the packaged assets against the Router public manifest.
The smoke exercises the emitted SSG HTML and client bundle, request-time SSR,
hybrid GET and POST, native 422 and 303 responses, the enhanced 422 response,
cookies and authorization isolation, both full-await positions, error pages,
and private artifact URLs. Dedicated routes exercise Nitro's cache rule and
Web stream transport. The final line says `runtime passed` after all checks.

The Node proof starts Nitro's emitted `node-server` entry on loopback. The
Workers proof calls the emitted `cloudflare_module` entry under Node with a
local `ASSETS` implementation and overlapping per-request env bindings. The
two commands serialize builds because they share the Router output and Nitro
staging directory. If an interrupted build leaves `.output-proof-lock/`, remove
that empty directory once its build processes have exited.

## Workerd on loopback

After `proof:workers`, start Wrangler against Nitro's generated configuration.

```sh
npx --yes wrangler@4.168.0 dev --local \
  --config tests/fixtures/router-nitro/.output-workers/server/wrangler.json \
  --ip 127.0.0.1 --port 41910 --var REQUEST_TIME_PROOF_TOKEN:fixture-worker-token
```

In a second terminal, run the HTTP smoke. This covers workerd and the local
Cloudflare asset router.

```sh
vp run --no-cache --fail-if-no-match --filter @openelement/fixture-router-nitro proof:workers --origin http://127.0.0.1:41910
```

The fixture routes `/guestbook` to the Worker first. The catch-all sends GET
and HEAD to `ASSETS` and lets Router handle POST. The Workers HTML policy
uses the same canonical path as the action. [Cloudflare asset routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)

## Workers preview

For an authorized preview, configure the `REQUEST_TIME_PROOF_TOKEN` binding
to the public fixture value `fixture-worker-token`. Use an origin containing
only this test fixture. The same HTTP smoke sends fixture form submissions to
that origin.

```sh
vp run --no-cache --fail-if-no-match --filter @openelement/fixture-router-nitro proof:workers --origin https://your-fixture.example
```

The HTTP smoke reports `HTTP fixture passed` with its target origin. Record the
deployed revision and origin when using it against a preview.
