# starter-smoke

Packed-starter **visual + interaction smoke** (#934). `setup.ts` packs the
release tarballs through the release toolchain (vp pack), runs the packed
`@openelement/create` CLI under Node to generate a fresh starter, rewires its
`@openelement/*` dependencies to those current-SHA tarballs, installs the
starter's own dependency surface with pnpm, and builds it; the Playwright
suites then drive that real build (B5/ADR-0161: Node/pnpm consumer surface).

```bash
pnpm --dir tests/e2e/starter-smoke run setup       # pack + generate + rewire + install + build
pnpm --dir tests/e2e/starter-smoke run test        # all three browser projects
pnpm --dir tests/e2e/starter-smoke run test:dev    # `pnpm dev` dev-mode smoke
pnpm --dir tests/e2e/starter-smoke run gate        # setup + test
```

Guarded regression classes: unstyled page (missing `:root` baseline), dead
island, jammed nav, clipped assets, duplicate H1 (#934); dev-mode island client
serving and route-edit SSR invalidation (#951/#952). `work/` is generated and
gitignored.
