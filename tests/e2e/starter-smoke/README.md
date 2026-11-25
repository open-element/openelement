# starter-smoke

Packed-starter **visual + interaction smoke** (#934). `setup.ts` packs the
release tarballs through the release toolchain (vp pack), runs the packed
`@openelement/create` CLI under Node to generate a fresh starter, rewires its
`@openelement/*` dependencies to those current-SHA tarballs, installs the
starter's own dependency surface with pnpm, and builds it; the Playwright
suites then drive that real build ([Node and pnpm consumer surface](../../../docs/adr/ADR-0161-node-pnpm-consumer-surface.md)).

The scaffold is created **outside the repository** in a per-run `mkdtemp`
directory (`paths.ts`, `STARTER_SMOKE_WORK_DIR` overrides the root verbatim).
`setup` records the chosen root in
`node_modules/.starter-smoke-work-dir` so `quality`, both Playwright configs
and `dev.spec.ts` — separate processes — resolve the SAME tree; a reader with
neither the override nor the pointer fails closed with "run setup first"
instead of inventing a second root. That location is part of the gate: inside
the repo, the repository's ancestor `.gitignore` made the starter's own bare
`oxlint` find zero files (`No files found to lint`, exit 1), which is not a
user-like environment. Never a fixed name under the temp dir (CodeQL
`js/insecure-temporary-file`), and `setup` removes the previous harness-created
root so repeated runs do not leak.

```bash
pnpm --dir tests/e2e/starter-smoke run setup       # pack + generate + rewire + install + build
pnpm --dir tests/e2e/starter-smoke run test        # all three browser projects
pnpm --dir tests/e2e/starter-smoke run test:dev    # `pnpm dev` dev-mode smoke
pnpm --dir tests/e2e/starter-smoke run gate        # setup + test
pnpm --dir tests/e2e/starter-smoke run quality     # TPL-03 lifecycle chain on the same scaffold
```

`quality` is the **starter quality gate** (TPL-03): after `setup` has created the
fresh scaffold through the packed create CLI, it runs the starter's own
lifecycle scripts against that same tree —
`typecheck` → `lint` → `test` → `build` — then boots `oe start` and probes
`/`, `/about` and `/api/ping` over the wire. It fails closed on any nonzero
script or failed probe, and it never re-packs or re-installs. CI runs it as a
named step in the base-layer `pack` job using that job’s packed scaffold.

Guarded regression classes: unstyled page (missing `:root` baseline), dead
island, jammed nav, clipped assets, duplicate H1 (#934); dev-mode island client
serving and route-edit SSR invalidation (#951/#952); the starter lifecycle
(typecheck/lint/test/build/start, TPL-03) in the user-like scratch root.
