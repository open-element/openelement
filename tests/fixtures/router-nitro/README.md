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
local `ASSETS` implementation and overlapping per-request env bindings. It
requests the exact HTML asset keys since clean URL resolution belongs to the
Cloudflare asset service.

For an authorized Workers preview of this fixture, configure the
`REQUEST_TIME_PROOF_TOKEN` binding to the public fixture value
`fixture-worker-token`. Use an origin containing only this test fixture.
The same task can then exercise the deployed HTTP endpoints, including
Cloudflare's clean static URLs.

```sh
vp run --no-cache --fail-if-no-match --filter @openelement/fixture-router-nitro proof:workers --origin https://your-fixture.example
```

A deployed run sends fixture form submissions and reports `deployed Router
fixture passed`. Record the deployed revision and origin with its result.
