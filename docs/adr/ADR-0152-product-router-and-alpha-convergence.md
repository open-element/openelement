# ADR-0152: Element, Router, and the public 1.0 Alpha baseline

- Status: ACCEPTED / AMENDED (2026-11-03; Lit retirement decision, implementation pending)
- Supersedes: former 0.44 release topology, five-package boundary, and in-repository UI/application
  qualification
- Preserves: ADR-0148, exact-SHA release trust, protected promotion, fresh verification, and human
  release authority

## Decision

### Public boundary

Element and Router are the public core. `@openelement/router` distributes Router;
the former Adapter Vite surface is now split between Element and Router tooling subpaths, and
`@openelement/create` is the independent bootstrap package. The first release on this boundary is `1.0.0-alpha.1`, a new public
baseline rather than a 0.x compatibility migration. The npm `alpha` tag is used for Alpha; `latest`
remains independently governed.

UI, showcase/site code, Reader/Mastodon, SaaS/reference applications, and agent/control-plane
infrastructure are outside this repository. Their history remains in Git. Future reference apps
must consume packed or published artifacts from an independent environment.

### Amendment (2026-09-13): reconciled repository ownership

The ownership sentence above is superseded. Reconciled for `1.0.0-alpha.1`:

- Element and Router are the public framework core.
- Create is the supported creation entry.
- UI stays in this repository as an experimental product, outside the 1.0
  stable API promise.
- Site stays in this repository (`www`) as the official product
  surface.
- SaaS stays in this repository (`apps/saas`) as an independent first-party
  application, governed separately from the Alpha repository candidate. It is
  not a core product and not part of the Alpha repository GO criteria.
- "Not a core public package" does not mean "not owned by this
  repository": UI/Site/SaaS do not extend the Element/Router stable API
  promise, but all are maintained here. Daily development may use
  workspace resolution; release qualification must install `deno pack`
  tarballs, never relative internal source paths.

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

## Release-object hold

Pre-1.0 GitHub Release objects and Git tags are retained until a later explicit maintainer decision.
This convergence work must not delete or edit them. Publication, tag creation, Release-object
mutation, and dist-tag changes require explicit maintainer authority; this decision grants none.

## Amendment (2026-09-16): Hono's role stated precisely

"Hono integration is an optional HTTP adapter" is amended to describe reality: Hono is a hard
dependency of Framework Mode as the internal composition layer of the generated server entry
(`new Hono()`, built-in middleware mounts, `app.notFound`), while every public authoring contract
(`@openelement/router/http`, `_middleware.ts`, API route handlers) speaks the dialect-free WinterCG
shape `(request, next) => Promise<Response>` adapted at that internal boundary; Route Mode's
matching core (`RouteTable`/`RouteResolution`) remains independent of Hono.

## Amendment (2026-09-16): Lit renderer mode is doctrine, not debt

`renderer:'lit'` is a first-class qualified renderer mode legislated by this ADR: a product
differentiator for the edge-runtime and WC-fullstack scenarios, not a platform-gap shim. Its
existence and removal are ADR-level decisions only. Qualification is enforced continuously by CI
(the `router-lit-framework` e2e specs run in the root `test:e2e` gate on every push); the spike
contract in `src/lit-ssr.ts` is the version matrix to consult when bumping lit or @lit-labs/ssr.
No periodic re-signing rituals, no consumer counting, and no adoption-based retirement triggers
apply; pre-release zero-consumption readings are void by construction.

## Amendment (2026-10-04, alpha8 review follow-up)

Two statements above are superseded by the ADR-0161 amendment of 2026-10-03
(the "完全去除 deno" owner ruling): the repository develops, tests, builds,
packs, publishes, and qualifies on Node with pnpm, and nothing requires a
Deno install.

- The 2026-09-13 amendment's closing clause — "release qualification must
  install `deno pack` tarballs, never relative internal source paths" — is
  superseded. Release qualification still requires packed artifacts and never
  relative internal source paths; the tarballs are packed and installed on
  Node (`vp pack`, pnpm scripts), and no `deno pack` step exists in any
  release or qualification path.
- Admission item 3's scope list "required Node, Deno, Bun, Nitro, and Workers
  scopes" is superseded: Deno is not a required scope. The admission gate
  runs the retained Node, Nitro, and Workers scopes plus the browser matrix;
  there is no Deno leg to qualify.

The decisions those statements carried — fresh verification against packed
artifacts rather than workspace-relative source paths — stand unchanged; only
their Deno carriage is retired.

## Amendment (2026-10-07, #1560): the original positioning restored

The 2026-09-16 amendment above is superseded. "Hono integration is an optional HTTP adapter"
is true again, by construction this time: the generated server entry composes on an internal
WinterCG layer (`@openelement/router/server-runtime` — the request scope, the `(request, next) =>
Response` middleware chain, the fn-form API mounts, the route layer, and the 404 terminal), the
built-in middleware (request-id, logger, CORS, secure headers, CSP auto-nonce, action body
limit) are the runtime's own WinterCG middleware, and the SSG prerender is the build's own
static generator over the same dispatch — no `hono` import remains anywhere in `@openelement/router`
source. `hono` is an optional peer of `@openelement/router`; the one adapter is
`@openelement/router/hono` (`createHonoAdapter`), which mounts the entry's WinterCG handler
inside a consumer's own Hono app and is the only module that resolves the peer. The dev server
(`@hono/vite-dev-server`, itself an optional peer) and the Nitro production entry consume the
entry's WinterCG exports (`openElementDevFetch` / `openElementHandler`) directly and need no
hono. Every public authoring contract is unchanged: `@openelement/router/http` keeps its exact
WinterCG shape, `_middleware.ts` and `middleware.use` remain `(request, next) => Response`, and
Route Mode's matching core remains independent.

Behavior parity with the replaced composition is deliberate: middleware ordering, the
`'/p/*'`-covers-`/p` scope semantics, the CORS preflight short-circuit and Vary appends, the
request-id validation, the security header set, the 405/Allow responder, the styled-404
terminal, and the SSG output naming are pinned by unit tests, the renderer-adapter byte pins,
and both read-only request-time oracles. One deliberate divergence: the logger's status
coloring is dropped — its color policy read `process.env`, which runtime code must not (P3).
The `virtual:open-hono-entry` module id and its `_virtual_open-hono-entry` asset prefix are
retained as legacy names with no dependency semantics; renaming them would churn build
artifacts for no observable change.

## Superseding amendment (2026-11-03): one Native product direction

The owner terminates the independent OhMyLit product initiative (research,
development and brand launch) and formally starts retirement of the first-party
Lit renderer. This supersedes the 2026-09-16 "Lit renderer mode is doctrine"
amendment and the future Native/Lit parity obligation in Framework Mode and
admission above. Element and Router remain the two core products. The target is
HTML-first Full TSX with explicit Signals, hostless internal composition and an
explicit native CE boundary; see the [product model](../architecture/product-model.md).

This is a product-focus decision, not an adoption count or proof that Lit/DSD
cannot work. External consumers are unknown, not known to be absent. Alpha.15
still implements and supports the existing Lit mode; this amendment deletes no
implementation, export, dependency or test, and supplies no new qualification.
Existing Lit checks remain necessary until a separately qualified retirement
candidate replaces that support contract.

The last supported version, breaking prerelease, compatibility period and owner
for security handling are **OPEN**. Do not silently assign retirement to alpha16,
rewrite historical release evidence or promise indefinite security maintenance
of an old branch. Users may pin an old version and assess its risks. Before a
retirement release, publish migration notes covering configuration, `./lit`,
`./lit-ssr`, server-runtime exports, hydration and first-screen/SEO effects.
`renderer: 'lit'` must receive an explicit migration error, never silently select
Native. Native rewrites and client-only migration are distinct choices.

Preserve third-party Lit Web Components as client-only interoperability, including
properties/events and platform boundaries. This gives no automatic SSR admission
and no promise that OpenElement hydrates foreign Lit DSD. Migrate shared
leaf-graph, forms/readiness, navigation and safety assertions before deleting
renderer-exclusive fixtures. Complete exports/dependencies/generated surfaces,
negative tests and full candidate qualification together before release. A rollback
restores the whole compatible server/client/build set as a new candidate, not a
single dependency or an overwritten published version. No removal or publication
is authorized by this documentation-only stage.
