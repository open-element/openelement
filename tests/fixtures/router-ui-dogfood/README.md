# router-ui-dogfood

`@openelement/ui` **dogfood qualification** fixture (#1226, v0.44 Beta.2). An
app consuming `@openelement/ui` the way an external consumer does: the package
enters through `packageIslands` (WC Package Protocol manifest) and plain page
markup, never through fixture-private shims. Every route is statically
prerendered, so each page exercises the real compile → SSR/DSD → serve →
hydrate path; interactive evidence lives in `e2e/*.spec.ts`.

```bash
pnpm --dir tests/fixtures/router-ui-dogfood run build
pnpm --dir tests/fixtures/router-ui-dogfood run gate    # build + e2e
```
