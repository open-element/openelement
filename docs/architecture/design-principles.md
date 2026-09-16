# Design principles

This document is the design constitution of OpenElement. It governs every
change to the framework's public contracts, runtime surface, and build
machinery. It is maintained as a living document; amending it requires an ADR.

The key words **must**, **should**, and **may** are to be interpreted as
normative requirements, recommendations, and permitted options.

The working rule is **comply or explain**. A change that deviates from a
principle is not forbidden, but the deviation must be named in the commit
message or ADR, citing the principle it trades against. An unnamed deviation
is a defect and is reverted.

## Preamble: why this framework exists

Per [The Extensible Web Manifesto][ewm], the standards process succeeds by
adding low-level capabilities to the platform and by explaining high-level
"magic" in terms of those primitives. Libraries and frameworks exist to
pioneer what the platform has not yet absorbed — and to be absorbed.

OpenElement takes that loop seriously. The framework is a **minimal delta on
top of web-standard APIs**: it supplies only what the web platform does not
(yet) provide, pays for it at build time wherever possible, and treats every
piece of itself as debt that must be deletable when the platform catches up.
Declarative Shadow DOM, CSS `@scope`, the Speculation Rules API, and View
Transitions are features this project adopted precisely because they let
framework code be deleted.

## Priority of constituencies

When principles conflict, decide in this order, adapted from the
[W3C TAG design principles][tag-dp]:

1. People using sites and apps built with OpenElement
2. Authors building with OpenElement
3. Implementors of OpenElement itself
4. Elegance of the implementation

A change that is convenient for the implementation but costs authors or users
loses. A change that is elegant internally but adds runtime surface to shipped
applications loses.

## P1 — Use the platform

The platform is the default implementation. The framework must not reimplement
what the web platform already provides, and what it provides to fill a gap is
debt with a retirement condition attached.

References: [The Extensible Web Manifesto][ewm];
[HTML Design Principles §3.5 Do Not Reinvent the Wheel][html-dp];
[open-webcomponent recommendations][open-wc].

In this repository: routing admission derives from WHATWG `URLPattern`; the
runtime component model is custom elements with Declarative Shadow DOM and
light roots; style scoping is CSS `@scope`; prefetching is the Speculation
Rules API; page transitions are View Transitions; the void-element set has one
canonical owner. Self-built regex routers, scoping runtimes, and metadata
extractors do not enter the tree.

Litmus: _Can the platform do this today, or is it on the standards track? If
yes, the framework writes nothing._

## P2 — Pay at compile time, not at runtime

Complexity is spent at build time. What ships must read as ordinary platform
code. Runtime surface added to user applications is presumed rejected.

References: [W3C TAG Web Platform Design Principles][tag-dp];
[The Rule of Least Power][least-power];
[Svelte — Rethinking Reactivity][svelte].

In this repository: the compiler lowers supported TSX to a Part Program at
build time (ADR-0143, ADR-0148); unsupported authoring fails with diagnostics
and never falls back to a runtime virtual-DOM path; SSR output is declarative
platform markup, not the product of a shipped render function. The build-time
IR is allowed to be custom because the runtime contract is the browser's own
component model; the IR must never leak into the runtime.

Litmus: _Does this add build-time surface or runtime surface? Runtime surface
needs an ADR._

## P3 — The server contract is WinterTC

Every server boundary is `fetch(Request): Promise<Response>`. The server-side
API surface must stay within the [WinterTC Minimum Common Web Platform
API][wintertc] plus explicitly declared extensions. No runtime dialect reaches
user code: no `process.env`, no Node HTTP bridge, no Hono/h3 context objects
in public contracts.

References: [WinterTC][wintertc] (normative, Ecma International).

In this repository: the canonical dispatch is
`dispatchRequest(request) => Promise<Response>`; fetch middleware is the
dialect-free WinterCG shape `(request, next) => Promise<Response>` composed at
the handler boundary; the dev server, the `start` CLI, the fixture server, and
the Nitro production entry run one handler. Hono is used only as a thin
composition layer over these primitives and must periodically re-justify its
place.

Litmus: _Does it run unchanged on Deno, Workers, and the Nitro mount?_

## P4 — HTTP fidelity and progressive enhancement

HTTP semantics are never silently degraded. Forms work without JavaScript;
GET cache semantics are never weakened without an explicit decision;
redirects, status codes, and method semantics stay faithful. Security
boundaries fail closed.

References: [HTML Design Principles §3.2 Degrade Gracefully][html-dp];
[Remix documentation][remix].

In this repository: a page exporting an action may keep a static GET —
prerendered with static cache semantics — while its POST runs at request time
(ADR-0120 amendment); action POSTs answer 303 PRG redirects, 422 validation
re-renders, and RFC 9457 problem JSON for fetch callers; framework-generated
scripts carry the per-request CSP nonce so the browser's own security boundary
accepts them; SSG rejects nonces by design rather than emitting incorrect
static output.

Litmus: _Disable JavaScript, enable CSP, put a cache in front — does it still
hold?_

## P5 — Designed for deletion

Every layer must be deletable. Compatibility lives only at deployment
boundaries and never leaks into application code. Every shim lands with a
written retirement condition.

References: [The Extensible Web Manifesto][ewm];
[Write code that is easy to delete, not easy to extend][tef].

In this repository: the Nitro mount is contained at the `dist/server` exit and
invisible to application code; string-splicing script injectors and
`Function.toString()` config serialization were deleted outright, not wrapped
in compatibility layers (Alpha permits breaking cleanup); retired ADRs are
preserved in Git history rather than kept as parallel documentation.

Litmus: _If the platform shipped this tomorrow, what exactly do we delete, and
how many lines of application code change? No answer, no abstraction._

## P6 — Single source, no parallel mechanism

When the data already exists in a standard artifact — the module graph, the
type checker, the filesystem, a Playwright report, a packed tarball — the
repository must not grow a second source of truth beside it. No registries,
scanners, or hand-maintained copies of what a canonical mechanism already
knows. Unavoidable copies ship with a drift guard, and the guard is temporary
by intent.

This principle is repo-internal case law, established during the Alpha.1
closure: diverged deny lists were the root cause of a real security gap; a
hardcoded file list let new files escape typechecking; an unbound sidecar made
E2E evidence forgeable.

In this repository: one protocol-level forbidden-sink predicate serves the
compiler, the client validator, and the server validator, with a drift guard
on the serialized `DANGEROUS_KEYS` copy; the starter typechecks its `app/`
directory natively; E2E evidence recomputes from the raw Playwright report
bound by SHA-256 and candidate SHA.

Litmus: _Is this a second source of truth?_

## P7 — The four-question review gate

Any addition to the framework answers four questions in review. The first
three restate P1–P3; the fourth is institutionalized prior art.

1. Can the platform do this? (P1)
2. Can the cost be paid at compile time? (P2)
3. If it must be runtime, does it read as platform code and honor the server
   contract? (P3)
4. What is the nearest mature prior art, and is our difference deliberate?

For question four, the working prior-art register is:
[The Extensible Web Manifesto][ewm] lineage (Polymer → [Lit][open-wc]),
[Enhance][enhance] (HTML-first, standards-first), [Remix][remix] (HTTP
fidelity), [Astro's islands architecture][islands] (selective hydration),
[Svelte][svelte] (compiler-pays), [htmx essays][htmx] (locality of behavior),
and [WinterTC][wintertc] (server contract). A difference from prior art that
cannot be articulated is design drift and is sent back.

## Platform catch-up review

Once per release cycle the maintainers list framework code that the platform
has newly made redundant and delete it. This review is how P1 and P5 stay
honest: the backlog is expected to shrink toward primitives, not grow toward a
meta-framework. Renderer forks and optional modes are re-measured against the
same ruler at each review and must justify their surface or be retired.

## References

- [The Extensible Web Manifesto (2013)][ewm]
- [W3C TAG — Web Platform Design Principles][tag-dp]
- [W3C — HTML Design Principles (2007)][html-dp]
- [W3C TAG — The Rule of Least Power (2006)][least-power]
- [WinterTC — Minimum Common Web Platform API][wintertc]
- [Remix documentation][remix]
- [Svelte — Rethinking Reactivity][svelte]
- [open-webcomponent recommendations][open-wc]
- [Enhance documentation][enhance]
- [Jason Miller — Islands Architecture][islands]
- [htmx essays][htmx]
- [tef — Write code that is easy to delete][tef]

[ewm]: https://github.com/extensibleweb/manifesto
[tag-dp]: https://w3ctag.github.io/design-principles/
[html-dp]: https://www.w3.org/TR/html-design-principles/
[least-power]: https://www.w3.org/2001/tag/doc/leastPower.html
[wintertc]: https://wintertc.org/
[remix]: https://remix.run/docs
[svelte]: https://svelte.dev/blog/svelte-3-rethinking-reactivity
[open-wc]: https://open-wc.org/
[enhance]: https://enhance.dev/docs/
[islands]: https://jasonformat.com/islands-architecture/
[htmx]: https://htmx.org/essays/
[tef]: https://programmingisterrible.com/post/139222674273/write-code-that-is-easy-to-delete-not-easy-to-extend
