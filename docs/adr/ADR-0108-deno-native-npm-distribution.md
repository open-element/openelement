# ADR-0108: npm distribution via `deno pack`

- Status: ACCEPTED

## Context

OpenElement is developed as a Deno workspace, while its public packages must be
ordinary npm artifacts usable by browser, Node, Bun, and edge toolchains.

## Decision

- Deno remains the repository toolchain; it is not a runtime requirement of
  browser-facing artifacts.
- `deno pack` produces npm tarballs for all retained packages.
- Packed artifacts are checked for export completeness, declarations, pure ESM,
  dependency ranges, and runtime-boundary violations before publication.
- npm publication uses GitHub Actions Trusted Publishing/OIDC and provenance.
- Packages publish in dependency order.
- JSR is not a release gate.

## Consequences

The repository keeps Deno-native configuration and tests, while disposable
consumer projects install the produced tarballs with npm and exercise the
actual published shape. Publication remains an explicit maintainer action after
the exact candidate SHA passes the release qualification workflow.
