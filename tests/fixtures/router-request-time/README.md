# router-request-time

Minimal openElement app proving **request-time rendering** (0.42.0-alpha.1):
routes with `renderIntent: { mode: 'dynamic' }` are excluded from prerendering
and served per request through `dist/server/index.js`. The generated
request-time server entry injects the island client entry (the framework fix,
not a fixture workaround), so islands hydrate here exactly like on prerendered
pages.

```bash
deno task --cwd tests/fixtures/router-request-time build   # build
deno task --cwd tests/fixtures/router-request-time gate    # build + e2e
```

`deno.lock` is generated and shares its universe with `router-native-framework`
byte for byte — see `tests/fixtures/README.md`. The fixture also carries the
ADR-0123 fetch-middleware proof (`app/middleware/`).
