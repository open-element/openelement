# Contributing to OpenElement

Read [SECURITY.md](./SECURITY.md), [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md), and [MAINTAINERS.md](./MAINTAINERS.md) before contributing.

## Normal changes

1. Start from `dev` and link a focused issue when one exists.
2. Change the product code or canonical documentation and add the smallest useful behavioral test.
3. Run the relevant Deno tasks and the complete applicable matrix before review.
4. Open a pull request to `dev`; the pull request and exact-SHA Actions checks are the operational record.

Do not commit agent prompts, dispatch transcripts, copied CI logs, temporary evidence, or per-attempt journals.

## Architecture review

Use an ADR only for a hard-to-reverse public API, package topology, architecture, security/trust, or explicit compatibility decision. Ordinary fixes do not need an ADR. Current architecture belongs in `docs/architecture`; retired decisions belong in Git history and the compact history index.

## Development

Use the Deno version pinned in `.dvmrc`.

```sh
deno task fmt:check
deno task lint
deno task typecheck
deno task test
deno task build
```

Use public package boundaries rather than private workspace imports. Prefer Web Platform primitives and established tools. Remove displaced implementations, tests, tasks, and documentation together.

## Release work

Follow [the release operation](./docs/maintainers/releasing.md). Local passes never authorize publication; releases require the exact candidate SHA, green required CI, human review, independent verification, and explicit maintainer approval.
