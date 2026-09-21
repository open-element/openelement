# Fixture locks

The six `tests/fixtures/*/deno.lock` files are GENERATED artifacts, not
hand-written inputs. Each one records the dependency universe of its fixture's
source entrypoint plus every `npm:` tool specifier that fixture's own
`deno.json` tasks invoke.

- Regenerate all of them: `deno task --cwd tools/repo fixtures:locks:update`
- Verify them (CI): `deno task --cwd tools/repo fixtures:locks:check`

`router-native-framework` and `router-request-time` declare identical
dependency universes, so their locks must stay byte-identical; the checker
fails when one is edited without the other. Each lock also carries
`jsr:@openelement/<pkg>@<version>` workspace links for the release line, which
is why a version bump is a six-point operation — see
`tools/repo/version-bump.ts` and the registry in
`tools/repo/check-fixture-locks.ts`.

## Layout

| fixture                   | lock universe                                                      |
| ------------------------- | ------------------------------------------------------------------ |
| `router-native-framework` | app-flow source fixture: SSR, dynamic routes, islands              |
| `router-request-time`     | request-time rendering source fixture (shares the native universe) |
| `router-lit-framework`    | Lit SSR integration (adds `lit`/`@lit-labs`)                       |
| `router-ui-dogfood`       | UI dogfood (adds `@openelement/ui` subpaths)                       |
| `router-nitro`            | real Nitro node-server + cloudflare_module proof                   |
| `web-component-interop`   | third-party custom-element interop corpus                          |
