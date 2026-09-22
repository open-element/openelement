# url-pattern-list-audit

Lockfile fixture for **npm registry signature and provenance verification** of
the externally published, OpenElement-maintained `@openelement/url-pattern-list`
matching fork (ADR-0152 / #1324). It carries no source: its only job is to pin
an exact dependency graph so `npm audit signatures` can verify the published
tarball's provenance.

```bash
deno task --cwd tools/repo url-pattern-list:provenance
```

This is the one fixture that is npm-shaped (`package.json` +
`package-lock.json`) rather than Deno-shaped, which is why it is exempt from
the `tests/fixtures/*/deno.lock` registry in `tools/repo/check-fixture-locks.ts`.
