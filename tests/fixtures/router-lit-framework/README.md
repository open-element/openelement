# router-lit-framework

`app-flow-lit` — the **Lit renderer** fixture (Beta.2.2, #1339). The same
application shape as the native notes flow, with page rendering swapped onto
the explicitly-configured lit renderer: pages are LitElement classes
default-exported via `defineLitPage()` from `@openelement/router/lit`, rendered
server-side by `@lit-labs/ssr` (DSD) and hydrated by `@lit-labs/ssr-client`.
Routing, loaders, actions (ADR-0120), form enhancement and morphing are the
shared framework machinery — only the page renderer forks.

`renderer: 'lit'` supports `layout: false` only (the compiled layout path is
rejected by the build), so the fixture stays layout-free.

```bash
pnpm --dir tests/fixtures/router-lit-framework run build
pnpm --dir tests/fixtures/router-lit-framework run gate    # build + e2e (all browsers)
```
