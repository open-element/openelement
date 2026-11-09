# ADR-0169: The request-time rendering surface — server function pages and the `./server` constructor helpers

- Status: ACCEPTED; AMENDED 2026-11-09 (bounded full-await server-function seam; see the amendment at the end) (implemented: `packages/compiler/src/internal/compiler/semantic-core/server-component.ts`,
  `packages/element/src/server.ts` (`@openelement/element/server`),
  `packages/router/src/authoring.ts` (`kind: 'function-page'`))
- Decided: 2026-10-18 (alpha15 server lane; record written in the alpha15
  consolidation batch)
- Preserves: ADR-0120 (the request-time foundation and its no-JavaScript
  baseline), ADR-0158 (streaming is an opt-in mode of the compiled server
  executor and stays a Part-Program channel)
- Related: ADR-0128 (page registration is decoupled from the tag-name export),
  ADR-0152 (product/router convergence), ADR-0163 (seam single ownership — the
  page lane's seam row is the "Server function page lane" row of
  [seams.md](../architecture/seams.md))

## Context

ADR-0120 established request-time rendering as first-class: a route may answer
per request, the loop (load → DSD render → progressive form → action →
error/redirect → revalidation) works without JavaScript, and static and
request-time routes coexist in one site. What it did not decide is the
**authoring surface for a page that has no client half at all**.

Until alpha15 every page was a compiled `@element` class: the transform emits a
Part Program, the route module default-exports `definePage(Class)`, the
generated entry registers the class, and a per-page island manifest decides what
reaches the browser. That is the right machinery for an interactive page — and
the wrong price for a page whose output is one-shot HTML: a legal notice, a
generated reference table, a landing section. Such a page paid for a Part
Program it never used, could be pulled into island/static-component scans it
cannot satisfy, and had no statement of what "server-only" means at the type
level.

The alpha15 server lane added the missing surface (compiler admission, element
runtime constructors, router descriptor and route wiring) without a decision
record. `rg -i "server function" docs/adr` returns nothing before this ADR, so
the shipped contract — a public `./server` subpath, three `__`-prefixed
constructor helpers, a `function-page` descriptor kind — had no written
boundary: what it is, what it is deliberately not, how it composes, and under
what conditions it is deleted.

## Decision

**1. A server function page is the route module's own exported TSX function
component, wrapped in the existing `definePage(Component, descriptor?)`.**

```tsx
export function Home(props: { heading: string }) {
  return <main><h1>{props.heading}</h1></main>;
}

export default definePage(Home, { head: { title: 'Home' } });
```

`definePage`'s discriminant is structural, not nominal
(`isElementPageClass`, `packages/router/src/authoring.ts`): a value carrying a
compiled Part Program (`__partProgram`) or a non-writable `prototype` (ES class
syntax) is the class branch; every other function-shaped value is the server
function branch. The default export becomes a descriptor with
`kind: 'function-page'` and its `render` IS the compiled component function —
no element class and no custom-element registration exist for the route.

**2. The compiler lowers the function into a generative HTML constructor; the
artifact is generated TS, not an IR and not an interpreter.** Admission and
lowering run through the SAME `Lowering` walk the `@element` class render body
uses (`compileServerComponentIfAdmitted`,
`packages/compiler/src/internal/compiler/semantic-core/server-component.ts`):
one attribute-name safety predicate, one sink denial, one `trustedHtml`
boundary, one OEC diagnostic family. Class-lane modules and component-less
modules answer `null` — the function lane is an admission bridge, never a
second checker. What differs is only the OUTPUT: instead of a Part Program the
admitted JSX lowers to a plain exported function composing the element server
runtime's constructor calls (below), with static attributes literalized, all
text on `__t`, per-item attribute slots resolved from an `each` template's
`item` binding, nested server function components composed by DIRECT call to
the imported binding, and admitted `@element` hosts on `__ssr`.

**3. The runtime surface is published as `@openelement/element/server`
(`__h`, `__t`, `__ssr`), and it copies no escaper.**

- `__t(value)` is `escapeText` over the serializer's own `displayValue`
  coercion — the ONE DSD text escape, applied to the coerced value.
- `__h(tag, attrs?, children?)` admits the element-tag grammar (intrinsic
  lowercase or a custom-element host), escapes every attribute value through
  the ONE canonical `escapeAttr`, validates attribute names through the one
  safe-name predicate, screens URL-carrying values through the ONE shared
  stream-frame URL policy, and routes the reserved `innerHTML` key through the
  ONE `trustedHtml` brand check.
- `__ssr(tag, props, composition?)` renders a registered compiled host through
  `renderToString` — the compiled serializer — so a nested `@element` component
  inside a server function page and a page-level component render through
  byte-identical machinery. The composition channel carries authored-order
  `[slotName, html]` pairs whose html is COMPILER-PRODUCED final HTML, and the
  runtime folds them into the host's own root mode (shadow-root hosts receive
  light DOM after their DSD template; light-root hosts receive projected
  children), exactly as the class path's nested expansion does.

The three helpers are **internal by convention** (`__` prefix), like the
generated entry's own `__setRequestTimeStyleSheetUrls`: application code calls
the compiled components, never the helpers. The subpath is server-graph-only by
construction — it imports compiled serializer internals directly and never
touches the root barrel, so hydration/claim installs stay out of every server
function component module.

**4. Server-only by construction, and therefore zero client emission.** A
function page produces no Part Program, no `@property` state machinery, no
element class, and no client graph edge; with no island composed it ships zero
client JS. The compiler decides this, not a build-time tree-shaking accident: a
function page is never emitted as a client chunk, and its module never appears
in the island manifest.

**5. Everything around the page is the existing pipeline.** The loader runs,
the `props` projector (or the default identity projection) builds the props
record, and the render output flows through the same renderer wraps, layout
wrap and document wrap as the class path — so the HTTP/DSD contract, head
resolution, the redirect/not-found channels, and the error projector's 500
re-render (which hands the error-projected props to the same render function)
behave identically. `renderIntent.stream` is a compiled-Part-Program channel
(ADR-0158) and is REJECTED on a function page: a page that must stream uses a
compiled `definePage` class route. Islands keep their existing admission
pipeline: a foreign or island host inside a server function body emits its tag
as-is and is owned by that pipeline, never by this lane.

## Four-question review

The design constitution's P7 four questions, plus the two governance questions
this repository asks of a new surface (P5 deletability, P8 single writer):

1. **Platform capability (P1).** The page is HTML construction on the server,
   which the platform already does; nothing is invented. The lane's whole job is
   to let authored TSX compile to the platform's own output — an HTML string in
   a `Response` — through the escapes and policies the serializer already owns.
   There is no runtime JSX, no virtual DOM, no template DSL and no interpreter.
2. **Prior art, and is our difference deliberate? (P7.4).** The nearest mature
   prior art is the "server component / server-only template" family:
   [Enhance](https://enhance.dev) (HTML-first, standards-first — but light-DOM
   by doctrine and a custom-element application loop), Astro's server-only
   components and islands (selective hydration — but its own component grammar
   and client directives), [Fresh](https://fresh.deno.dev) (request-time-first,
   Preact-bound), and Remix/React Router's loader→render split (HTTP fidelity —
   but a client hydration runtime underneath). The JSX-that-never-reaches-the-
   browser line also runs through React Server Components. Our deliberate
   differences: (a) the authoring surface stays the repository's ONE TSX grammar
   and ONE semantic walk — the function lane is an output mode of the existing
   compiler, not a second framework; (b) the output is DSD-first HTML for a Web
   Component application, so a zero-island page needs no hydration at all; (c)
   the cross-boundary escape/URL/trust policy is shared code, not a parallel
   implementation. A difference that could not be articulated would be design
   drift; these three are the articulation.
3. **Deletability (P5).** The whole lane is deletable as one unit with a named
   condition: if the platform (or the maintained framework baseline) ever makes
   a compiled server function indistinguishable from a compiled class page in
   cost, the lane's admission bridge, the `./server` subpath and the
   `function-page` descriptor kind are removed together, and such pages author
   as class pages again. Nothing else depends on the helpers: they are internal
   by convention, so no published API promise outlives the mechanism.
4. **Single writer (P8).** Per boundary: the compiler's `Lowering` walk is the
   one writer of the emitted constructor calls; `packages/element/src/server.ts`
   is the one implementation of the three helpers (it copies no escaper — every
   escape delegates to the serializer's own functions); `definePage` is the one
   writer of the `function-page` descriptor; the generated entry is the one
   writer of the route's render binding. The lane's row in
   [seams.md](../architecture/seams.md) names the owner, the crossing
   artifacts, the guard tests and the missing/unreadable behavior, and its
   guard tests fail closed if any of the four drifts.

## Alternatives considered

- **Compile a zero-island page as a compiled class with `strategy: 'only'` /
  no islands.** Rejected: it pays the Part Program, the class registration and
  the island-manifest machinery for output that is never hydrated, and it leaves
  "this page has no client half" as a build-time outcome rather than an
  authoring fact — a page could acquire a client chunk by accident.
- **A runtime JSX/vDOM renderer for the server (React-style `renderToString`).**
  Rejected: it is not platform code, it adds a runtime the framework does not
  own, and it duplicates the semantic walk the compiler already performs.
- **A new template-literal DSL (or Lit `html`) as the server function body.**
  Rejected: a second grammar means a second semantic authority and a second
  escape pipeline, exactly the parallel-checker failure the class path's one
  `Lowering` walk exists to prevent.
- **Compile to an IR and interpret it at request time.** Rejected: the artifact
  would be an interpreter's input, not a plain function; the emitted TS/JS is
  inspectable, type-checkable and directly executable.
- **A public `@openelement/server` authoring package with a stable helper API.**
  Rejected for now: the helpers are compiler output, not authoring surface. A
  public API would freeze their signatures as a compatibility promise before any
  consumer needs to call them, and P5 would then have to delete a published
  surface instead of an internal one.
- **Streaming server function pages.** Rejected: ADR-0158's streaming is a
  mode of the compiled Part-Program executor (deferred fields backfilled as
  Parts); a function page has no Parts to backfill and no client claim to
  reconcile. The coded refusal keeps one streaming owner.

## Limits

- No streaming on a function page (`renderIntent.stream` is rejected, coded);
  streaming stays with the class lane per ADR-0158.
- No client interactivity on a function page by itself: no islands, no
  `@property` state, no lifecycle. A page needing any of those is a compiled
  class route (possibly with islands).
- The helpers are internal by convention and carry no public compatibility
  promise; `@openelement/element/server` is a server-graph entry, not an
  authoring API.
- `__ssr` composes admitted compiled hosts only; a package island or foreign
  custom host is emitted as a tag and delivered by the existing island
  admission pipeline. The composition channel's slot semantics follow the
  class lane's own rules (name coercion, per-slot ordering, root-mode folding).
- The lane changes no loader-data shape and no action protocol; ADR-0120's
  loop, ADR-0128's registration decoupling and ADR-0152's router convergence
  are untouched.

## Consequences

- A page that has no client half now says so at the authoring surface, and the
  build cannot silently give it one.
- Text and attribute escaping on such a page have exactly one implementation
  each, shared with the DSD serializer; a divergence is a test failure, not a
  second code path.
- The compiler's admission bridge is the only door into the lane: a module the
  class path would reject cannot enter through the function path.
- The `./server` subpath joins the package's public export map without
  pretending to be authoring API; retiring the lane retires it in one step.

## Evidence

- `packages/compiler/__tests__/server-component-dispatcher.test.ts` — the
  admission bridge (class-lane and component-less modules answer `null`).
- `packages/compiler/__tests__/server-component-artifact.test.ts` — the emitted
  constructor shapes (static attributes literalized, per-item attribute slots
  reach the constructor).
- `packages/compiler/__tests__/server-component-xss-matrix.test.ts` — the XSS
  matrix over the real executed artifact.
- `packages/compiler/__tests__/server-component-composition.test.ts` — the
  composition channel's name coercion and the light-root fold.
- `packages/element/__tests__/compiled-server/compiled-composition.test.ts`,
  `ssr-host-attributes.test.ts`, `server-html.test.ts` — the `__ssr`
  composition contract, host-attribute normalization and zero-property hosts.
- `packages/router/__tests__/function-page.test.ts` — the `definePage`
  discriminant matrix, scanner admission, generated-entry wiring (zero-client-
  entry shape included), and the executed request-time + SSG harness against the
  real runtime seams with hostile loader payloads.
- `tests/fixtures/router-request-time` — the request-time fixture's own gate
  (typecheck + build + three-engine e2e), run by `@openelement/fixture-router-request-time#gate`
  in `gate:source` and in the `e2e-full` CI layer.

## Amendment (2026-11-09): full-await server function pages (bounded)

Status: ACCEPTED, bounded implementation in `packages/router` + the compiler
server-component lane. This amendment does not change the Alpha15 synchronous
contract and does not complete M14.

### Context

ADR-0169 decided the synchronous server function page: the module's exported
function component renders to a string and `renderFunctionPage(page, props)`
returns that string. The compiler rejects `async` components with `OEC9032`.

Alpha16b's M14 requires async server components with **full-await** semantics:
the component awaits its data, then returns its JSX; HTML is produced only
after every await settles. The execution plan (§3) makes M14 parallelisable
with M05–M11 and explicitly non-gating for Alpha16a.

The first bounded slice (`#1748`) implements the seam on the **Alpha15 server
lane**, not on the M08 generated-leaf chain.

### Decision

1. **A new published seam is added**: `renderFunctionPageAwaited(page, props):
   Promise<string>` on `@openelement/router/server-runtime`. Generated normal,
   error, 404 and SSG function-page entries await it. The sync
   `renderFunctionPage` keeps its existing `(page, props) => string` contract,
   including `String(thenable)` with no observation, so existing callers do not
   change.
2. **Bounded grammar.** An async server function component is admitted only
   when it is a single JSX return, with `await` permitted in text children and
   in nested server-component props. Attribute await, condition await,
   list-item await, arbitrary-expression await, and a synchronous parent of an
   async child stay refused with `OEC9032`. Statements before the return and
   block-bodied arrows are admitted as near-misses and refused at the
   production admission bridge with the same code (they must not fall through
   as runtime JSX).
3. **No new sink.** Awaited text goes through the existing escaped `__t`
   channel; attributes/URL/raw-HTML admission is unchanged.
4. **The server-only graph guard is unchanged**: server-only imports still do
   not reach a client graph, and unmigrated async work must not add a second
   path.
5. **Bounded, not M14 exit.** This amendment records a bounded slice. M14's
   exit ("awaited output, server-only graph guard intact" for the full M14
   surface) stays open; the M07/M08 claim chain is not replaced by this seam.
   Bounded defer, streaming, cancellation and request-scoped ownership remain
   Alpha18 (ADR-0158/ADR-0174 boundary).

### Consequences

- The published surface grows by one additive function; the interface snapshot
  records it (ADR-0137). No version bump, tag, publication or ABI freeze is
  implied.
- The synchronous seam's rejection of unbounded async shapes is a compile-time
  diagnostic, not a runtime fallback; a user cannot get silent sync rendering
  of an async component.
- The Alpha15 lane and the future M08 generated-leaf server backend stay
  separate until M08 decides the shared SSR producer; this slice does not
  pre-empt that decision.

### Evidence

- `packages/router/__tests__/function-page.test.ts` — the awaited seam, the
  preserved sync contract, and the generated-entry wiring.
- `packages/compiler/__tests__/server-component-full-await.test.ts` — bounded
  grammar admission, sync-parent refusal, await-position refusals, and the two
  production admission near-misses.
- `packages/compiler/src/internal/compiler/semantic-core/{server-component,
  lower-program}.ts` — admission and lowering.
- `packages/router/src/vite/internal/server-runtime/page-render.ts` — the shared
  render-function / reserved-`children` checks behind both seams.
