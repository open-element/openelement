# ADR-0152: Element, Router, and the public 1.0 Alpha baseline

- Status: ACCEPTED (reconciled for `1.0.0-alpha.1` on 2026-09-11)
- Supersedes: former 0.44 release topology, five-package boundary, and in-repository UI/application
  qualification
- Preserves: ADR-0148, exact-SHA release trust, protected promotion, fresh verification, and human
  release authority

## Decision

### Public boundary

Element and Router are the public core. `@openelement/app` distributes Router;
`@openelement/adapter-vite` and `@openelement/create` are retained support packages. The first
release on this boundary is `1.0.0-alpha.1`, a new public baseline rather than a 0.x compatibility
migration. The npm `alpha` tag is used for Alpha; `latest` remains independently governed.

UI, showcase/site code, Reader/Mastodon, SaaS/reference applications, and agent/control-plane
infrastructure are outside this repository. Their history remains in Git. Future reference apps
must consume packed or published artifacts from an independent environment.

### Router

Route Mode consumes explicit records. Its matching core is independent of Element, renderers, Vite,
filesystem access, and Hono. Hono integration is an optional HTTP adapter. One selected URL record
owns method policy; unsupported methods return 405. Query parameters and path captures remain
separate, and public browser projections exclude handlers and host bindings.

Framework Mode adds file routing, loaders/actions/forms, resolved Document meaning, navigation,
SSR/SSG, and official Vite integration. Native and Lit are separately qualified renderer modes.
They share application semantics, not renderer internals. Explicit and generated routes converge on
one `RouteTable`/`RouteResolution` model.

### Element and compiler delivery

Element is independently consumable: author, compile, pack, then load from ordinary HTML without
Router or workspace aliases. The private compiler is delivered through supported tooling and meets
the runtime only through versioned artifacts. Compiler, Node, and Vite implementation code must not
leak into browser output or browser declaration graphs.

### Generic dependencies

OpenElement consumes the independently maintained `@openelement/url-pattern-list` package with
source provenance and tests. URLPattern remains the platform/polyfill grammar owner. OpenElement
owns route records, methods, request lifecycle, and rendering semantics; none belong in the generic
list library.

### Repository reduction

Every replacement removes its displaced implementation, compatibility layer, duplicated truth,
one-off checker, and obsolete documentation. Git is the operational-history archive. Mature generic
checks run through their upstream tools; local scripts remain only for OpenElement-specific semantic
or distribution contracts.

## Admission

The exact final candidate must pass:

1. formatting, lint, types, tests, coverage, package/config/surface checks, and security tooling;
2. isolated packed worlds for Element, Router Route Mode, Native Framework Mode, and Lit Framework
   Mode;
3. Chromium, Firefox, and WebKit contract/application coverage plus required Node, Deno, Bun, Nitro,
   and Workers scopes;
4. clean source/browser/server/declaration dependency graphs and reproducible package artifacts;
5. required GitHub CI and security checks on the same SHA;
6. a fresh independent verifier, human review, and explicit maintainer GO.

Missing evidence is not a pass. A new candidate SHA invalidates prior candidate-bound evidence. Tool
availability, provider wrappers, historical evidence files, and self-review cannot substitute for a
required reviewer or check.

## Release-object reset

Before the first 1.0 Alpha release, enumerate all Git tags and GitHub Release objects. Delete every
pre-1.0 GitHub Release object while preserving all Git tags and their target SHAs. Release tooling
must work when no historical Release object exists. Publication, tag creation, and the first new
Release object require explicit maintainer authority; this decision grants none.
