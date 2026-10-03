# site-light-probe

**Light-root rendering** acceptance probe (#1148 / ADR-0142). Moved out of
`www`: the probe proves the compiled light-root rendering path, not a public
Site surface. It keeps the exact SSR → delayed-upgrade shape the browser matrix
covers (light-root page, light-root island, real public package exports)
without any Site shell, navigation, or content collections.

```bash
pnpm --dir tests/fixtures/site-light-probe run build
pnpm --dir tests/fixtures/site-light-probe run e2e:browsers
```
