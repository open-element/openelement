# router-static-only

Minimal openElement app with **only static routes** (0.42.0-alpha.17, #953): no
route uses `renderIntent: { mode: 'dynamic' }`, so the build must not produce a
request-time server entry and `cli/start --mode=preview` must accept the
output. The `.mdx` route pins build-time markdown prerendering (#954).

```bash
deno task --cwd tests/fixtures/router-static-only build
```

The build output is gitignored; `packages/router/__tests__/static-only-build.test.ts`
rebuilds the fixture on demand and asserts both contracts. This fixture has no
`deno.lock`: it resolves no external universe of its own.
