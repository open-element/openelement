# starter-smoke

Packed-starter **visual + interaction smoke** (#934). `setup.ts` runs the packed
`@openelement/create` CLI to generate a fresh starter, rewires its
`@openelement/*` imports to monorepo sources, and builds it; the Playwright
suites then drive that real build.

```bash
deno task --cwd tests/e2e/starter-smoke setup       # generate + rewire + build
deno task --cwd tests/e2e/starter-smoke test        # all three browser projects
deno task --cwd tests/e2e/starter-smoke test:dev    # `deno task dev` dev-mode smoke
deno task --cwd tests/e2e/starter-smoke gate        # setup + test
```

Guarded regression classes: unstyled page (missing `:root` baseline), dead
island, jammed nav, clipped assets, duplicate H1 (#934); dev-mode island client
serving and route-edit SSR invalidation (#951/#952). `work/` is generated and
gitignored.
