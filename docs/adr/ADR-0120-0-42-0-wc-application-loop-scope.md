# ADR-0120: 0.42.0 WC Application Loop Scope and Action Protocol

- Status: ACCEPTED
- Date: 2026-07-27

## Context

Stable `0.41.0` froze the static/SPA semantics of `defineApp` and explicitly
left request-time data, forms, sessions and cache unfrozen (ADR-0119). The
roadmap assigns those semantics to `0.42.0` (WC Application Loop): one
route-to-interaction loop — load, DSD render, progressive form, action,
error/redirect and revalidation — that works without JavaScript.

Two questions had to be answered before implementation:

1. **Scope boundary**: what does openElement build itself, and what does it
   take from third parties or Web standards?
2. **Protocol shape**: what is the wire format, the error/redirect algebra,
   the revalidation default, and the rendering-continuity strategy?

The evidence base is a commissioned six-framework study of mainstream
application loops, archived at
[`docs/audit/2026-07-27-application-loop-framework-research/`](../audit/2026-07-27-application-loop-framework-research/README.md)
(Remix/React Router, SvelteKit, Astro, Fresh, Enhance, Hotwire/htmx; every API
claim carries an official-documentation URL). The study shows strong
cross-framework convergence on the protocol layer and confirms that the
WC + DSD-default + static-first fullstack slot is unoccupied: the closest
incumbent (Enhance) is light-DOM by doctrine and slowed feature development
after its 2024 acquisition; Fresh is request-time-first and Preact-bound.

## Decision

### Scope boundary (self-built vs third-party)

Self-built, because they define what an openElement application **is**:

- the loop semantics (load → DSD render → progressive form → action →
  error/redirect → revalidation);
- the no-JavaScript path, as a baseline rather than a fallback;
- the loader/action contract shapes;
- the rendering-continuity mechanism (morph + named partial + preserve),
  because every vDOM-based incumbent mechanism does not transfer.

Third-party or Web-standard, because self-building them is pure liability:

- the server layer stays hono (dev) and Nitro (output); request-time handlers
  are functions running on Nitro, not a new server abstraction;
- loader/action context is the Web-standard `Request` / `Response` /
  `FormData` — zero new dependency;
- validation stays with the user (zod/valibot in the action body); the
  framework owns only the form→action wiring and the error shape.

Out of scope, per the roadmap rules, and repeated here as a hard guard:

- sessions and cache semantics stay with `0.44.0`; `0.42.0` reserves context
  slots but ships no semantics, and request-time routes ship with a
  conservative no-cache default only;
- auth, OAuth, ORM, databases and storage remain recipes, never packages;
- no new package is created; the five-package graph is unchanged, and
  `@openelement/element` is expected to need zero changes (needing one is a
  stop-and-recheck signal);
- the ADR-0119 frozen surface is untouched: `defineElement`, `definePage`,
  `buildApp` and the static/SPA semantics of `defineApp` do not change; the
  SPA client-side chain stays client-side.

### Action protocol (from the cross-framework convergence)

1. **Wire format**: standard HTML form POST, no framework-private protocol.
   Only GET/POST are used. Named actions are dispatched by a URL query
   convention (`?/name`) or the native `formaction` attribute, following the
   SvelteKit model.
2. **One POST, two responses**: without JavaScript the action endpoint
   answers with full HTML; with JavaScript the same POST (marked by a
   framework request header) answers with a serialized `ActionResult`
   discriminated union `{ success | failure | redirect | error }`. The
   request body never differs between the two paths.
3. **Three-state status rule**: a successful non-GET action MUST answer 303
   (POST/Redirect/GET is built into the framework, not left as a recipe —
   Astro leaving it manual is its documented weakness); a validation failure
   answers 422 with the form re-rendered, echoing submitted values minus
   sensitive fields; an action endpoint MUST NOT answer 200 with a rendered
   page for a successful mutation.
4. **Error dichotomy**: thrown values take the exception channel (nearest
   error boundary, aligned with the existing `RenderError` contract);
   expected business failures return through the result channel
   (`fail(status, data)` shape). Validation errors are returns, never throws.
5. **Revalidation invariant**: after a successful action, the route's loaders
   re-run and the page re-renders; developers write zero synchronization
   code. In a server-rerender (DSD) world this Remix invariant is free, and
   the no-JS path gets it from the browser natively. Route-level opt-out
   (`shouldRevalidate` analogue) is deferred until a proven need exists.
6. **Rendering continuity**: action re-rendering replaces page regions by
   name (Fresh's partial protocol, pure HTML attributes), using
   idiomorph-style DOM morphing with a preserve-attribute escape hatch
   (Hotwire's proven WC-portable design space). Hydrated islands outside a
   replaced region keep their state; islands inside are matched by identity
   and preserved where possible. Exact semantics are alpha.3 evidence work.
7. **Static/request-time hybrid**: routes declare prerendering with a
   route-level option (SvelteKit/Astro page-option model), and the build
   manifest mechanically enforces the hard rule **pages with actions cannot
   be prerendered**. Static and request-time routes coexist in one site.

### Release shape

The line ships as four themed alphas plus the stable decision
(`0.42.0-alpha.1` request-time rendering foundation; `alpha.2` the
form/action loop with the protocol above and the revalidation invariant
built in; `alpha.3` revalidation continuity and morph/partial evidence;
`alpha.4` hardening, recipes and starter), each with the release-tier gate
discipline of the 0.41 line. The stable freeze decision for request-time
semantics is a separate ADR at the end of the line.

## Consequences

Positive:

- Every protocol choice is evidence-backed by at least one production-proven
  incumbent rather than invented, and the wire format requires no
  framework-specific client to function.
- Built-in PRG and the WC + DSD + static-first combination are clear
  differentiators; the slot is confirmed empty.
- The frozen `0.41.x` line is untouched; static-only users pay zero upgrade
  cost, which the alpha.1 byte-identical-output gate will prove.

Negative:

- The morph/partial continuity mechanism is real new client-side code with a
  state-preservation matrix that no incumbent can validate for us; alpha.3
  carries that risk by design.
- Deferring `shouldRevalidate`-style opt-outs may ship a conservative
  revalidation cost on data-heavy pages until 0.43/0.44.

Neutral:

- The six research reports become permanent audit evidence; future protocol
  changes must argue against them, not against memory.
- Session flash across redirects is deliberately not built (session is 0.44
  scope); the 422 same-request re-render covers the form-error UX without it.

## Amendment (2026-09-16): hybrid pages — static GET + request-time POST

Item 7's hard rule **pages with actions cannot be prerendered** is repealed.
The prohibition was never load-bearing: HTTP itself admits GET and POST on one
path, the generated entry already registers the POST action handler for every
page route unconditionally, and the request dispatcher already admits every
non-GET/HEAD method to the server by method, not by path.

The contract is now:

- A page that exports an action may keep `renderIntent.mode` unset/`'static'`.
  Its GET is prerendered like any static page and served from the static
  artifact with static cache semantics (`no-cache` revalidation); it is NOT
  downgraded to the request-time `private, no-cache` channel. Its action POST
  is dispatched to `dist/server/index.js` at request time with unchanged POST
  semantics (`no-store`, `Vary` on the action header, 303 PRG coercion,
  422 re-render, problem+json for fetch callers).
- `dist/server/` (server entry + `server-manifest.json`) is emitted when the
  project has any `renderIntent: { mode: 'dynamic' }` route OR any page with
  an action. Pure-static projects (zero actions, zero dynamic routes) keep an
  unchanged output tree.
- The manifest schema is unchanged (version 1; `requestTimeRoutes` lists only
  `'dynamic'` routes). Hybrid routes get no manifest entry: POST admission is
  method-based, and no manifest consumer assumes "manifest routes == all
  POST-capable routes" (audited: `build-plan.ts` build-manifest evidence,
  `cli/start.ts`, the e2e fixture server, `tools/release/` packed-serve
  harnesses, and the CI dist/server smoke jobs — all either read
  `requestTimeRoutes[].path` only or dispatch by method/path existence).
