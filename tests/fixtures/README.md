# Fixture dependencies

Since the B2 manifest conversion each fixture is a pnpm workspace member with
its own `package.json`; dependency resolution is the workspace's single root
`pnpm-lock.yaml`. There are no per-fixture Deno locks anymore (the former
`fixtures:locks:*` mechanism retired with the deno.json files).

Each fixture's `package.json` declares the dependency universe its sources
plus build tasks invoke. `router-native-framework` and `router-request-time`
are behavioral twins in app flow, not in dependencies: both build on
`@openelement/element` + `@openelement/router` + hono, while native pins `lit`
and request-time pins the `@zag-js/*`/`valibot`/`zod` request-time stack.

## Layout

| fixture                   | dependency universe                                                |
| ------------------------- | ------------------------------------------------------------------ |
| `router-native-framework` | app-flow source fixture: SSR, dynamic routes, islands              |
| `router-request-time`     | request-time rendering source fixture (native app-flow twin)       |
| `router-lit-framework`    | Lit SSR integration (adds `lit`/`@lit-labs`)                       |
| `router-ui-dogfood`       | UI dogfood (adds `@openelement/ui` subpaths)                       |
| `router-nitro`            | real Nitro node-server + cloudflare_module proof                   |
| `web-component-interop`   | third-party custom-element interop corpus                          |
