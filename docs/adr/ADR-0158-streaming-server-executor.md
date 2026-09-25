# ADR-0158: Optional streaming mode of the compiled server executor

- Status: PROPOSED for 1.0.0-alpha.5; subject to main-agent review
- Tracking: #1444, #1447, #1450, #1453
- Preserves: ADR-0143, ADR-0148, ADR-0120, ADR-0129, ADR-0152, ADR-0153

## Decision boundary

Streaming is an opt-in mode of the compiled server executor for a dynamic
full-document page GET, not a new renderer, runtime JSX, VNode fallback, or
application-facing Nitro/Hono context. The generated handler still returns a
Web `Response` with a `ReadableStream` body. Nitro Node and Workers are
deployment exits for that same handler.

The two granularities are independent: the server can flush a shell and
backfill Parts in loader-field resolution order; islands still activate on
`load`, `idle`, `visible`, `media`, or `only`. Neither axis schedules the other.
The ordinary serializer, fresh-DOM executor, and claim executor continue to
consume the one versioned Part Program. Static and non-streaming output
remain byte-identical when the mode is off.

## Exact authoring and admission contract

The initial public authoring shape is:

```ts
export const loader = ({ request }: LoaderContext) => ({
  title: 'Known before flush',
  fieldA: fetchFieldA(request),
  fieldB: fetchFieldB(request),
});

export default definePage(CompiledPage, {
  renderIntent: { mode: 'dynamic', stream: { defer: ['fieldA', 'fieldB'] } },
});
```

`stream` is valid only with `mode: 'dynamic'`; `defer` is a nonempty,
duplicate-free list of literal, safe property names. An omitted `stream`
means the existing path. The loader still returns **one object** (or a promise
of that object); each named field may be a promise/thenable settling once.
The handler awaits loader setup and every undeferred field before committing
the shell, but does not await deferred fields. An undeclared thenable, missing
declared field, rejected setup, or non-object result fails before the first
byte. Independent deferred fields emit independently. No multiple-loader
convention or new loader-data shape is introduced.

The handler attaches settlement/rejection observers to every declared field
as soon as the loader object is available, even while awaiting front-gate
work; it must not create unhandled rejections. A deferred rejection known
before response commitment takes the normal pre-commit error path. After
commitment it takes the bounded ADR-0159 Part-failure path. Settled results
held while the shell is prepared count against the same bounded queue.

For this first mode, the default route projection is the only admitted
projection: `data.fieldA` maps by **identity** to the page's compiled
`fieldA` property/signal. A deferred name must be a declared writable,
non-computed property with `attribute: null` and `reflect: false`; it may not
collide with a route param or another injected page property. No arbitrary
`props` projector, nested path, alias, unknowable spread, or request-dependent
head resolver is inferred. An unsupported mapping fails the streaming build,
with route, field, source location, reason, and remedy (make the value
front-gate, bind directly to a nonreflecting property, or leave streaming
off). Ordinary non-streaming routes are unaffected.

The compiler derives a **route-specific** manifest from the route's literal
`defer` list, default projection, compiled property metadata, source map,
and that page program's existing signal-to-Part/Region dependencies:

```text
route -> loader field -> same-named page property/signal
      -> owning page-program identity -> eligible Part/Region indices
```

This manifest is generated with the route entry and version-bound to the
program; it is not a global loader annotation on a reusable Part Program.
Every consumer of a deferred signal must be accounted for. Only anchor-owned
text Parts and bounded `when`/`each` Regions may be deferred. A dependency
through a computed signal (including transitive dependencies), a shell/layout
or head value, host/child opening tag, attribute, boolean, class, style, raw
HTML, ref, event, slot routing, or opaque renderer/foreign component is **not**
admitted. A Region's item template is allowed only when its dynamic item
values are wholly owned by that Region and pass normal serializer escaping.
Mixed eligible and ineligible uses reject the whole field: no partial
deferral. Diagnostics name the exact sink and source range, e.g.
`fieldA -> computed total -> text p3` or `fieldB -> attribute p4`, and
suggest keeping the field front-gate, removing the sink, or disabling
streaming. A renderer wrapper requiring complete HTML, closed-shadow root,
or dependency crossing an unmapped element instance rejects this mode.
The initial boundary is a native compiled page with light DOM or accessible
open DSD; third-party Lit remains a separately qualified leaf under
ADR-0157, not an inferred deferred owner.

## HTTP commitment and ADR-0129

Before constructing the success `Response` and exposing its body, the
generated handler completes middleware admission, authentication/security,
CSRF where applicable, route selection, loader setup and front-gate values,
status/redirect/not-found/error decision, resolved Document head, header
channel merge (including all `Set-Cookie` values), cache policy, and CSP
nonce. No deferred computation may own a redirect, cookie, response status,
or header decision. A pre-commit failure takes the existing response path
with its true status, never a leaked success shell.

The response headers are copied/frozen at that commitment point, **before
the first chunk**. ADR-0129 already says mutation of `responseHeaders` after
the response is a no-op. This proposal preserves that rule: the generated
stream handler gates every `Headers`-compatible mutator on the per-request
context (including held references), ignores late `append`/`set`/`delete`,
and emits a structured late-write diagnostic naming route and header.
It never mutates committed headers, throws a Part error for a header write,
or reinterprets a late `Location`/`Set-Cookie` as a redirect. Protocol-header
precedence and multi-value `Set-Cookie` merge remain as in ADR-0129. A
deferred `redirect()`/not-found/status attempt is instead a late Part
protocol failure under ADR-0159; it cannot alter HTTP status. Changing late
writes to throws would require an ADR-0129 amendment; **this is not one**.

Actions, form POSTs, uploads, webhooks, custom API handlers, and security
rejections keep their existing non-streaming semantics. Static GET plus a
request-time action POST remains static for GET. The existing 303/422/
problem+json channels and persistence effects do not change.

## Route-behavior matrix

| Route/request                                                | Entry and loader                              | Response and stream behavior                                                                                             |
| ------------------------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Static GET (with or without action POST)                     | Existing prerendered artifact                 | Byte-identical static response; no stream metadata or text end anchors                                                   |
| Dynamic GET without `stream.defer`                           | Existing request-time loader/serializer       | Byte-identical non-streaming response; no backfill                                                                       |
| Dynamic full-document GET with admitted `stream.defer`       | One loader object; front gate completes first | Final status/headers/cookies, then shell, then independently resolved Parts; ADR-0159 frames and no-JS tail              |
| Opted-in GET, pre-commit redirect/auth/404/error             | Existing status and error/redirect path       | True status; no success shell or deferred frames                                                                         |
| Opted-in GET, post-commit deferred failure                   | Same request, immutable HTTP metadata         | Terminal bounded error frame or stream termination; never changed status/header                                          |
| Any action POST, upload, webhook, API, or security rejection | Existing handler                              | Non-streaming; no partial success                                                                                        |
| Enhanced client navigation GET                               | Existing client-router behavior               | **Not** a streamed-part consumer here; a future separately specified response/installer path must be opted in and tested |

Full-document browser GET is the baseline scope. The installer belongs to
that document; no assumption that an enhanced GET's fetch or fragment
replacement already consumes this wire format. ADR-0159's navigation rules
apply when a streamed document has an active owner, without broadening
enhanced GET behavior.

## Flow control and cancellation

The producer writes on demand from `ReadableStream` pull/async-iteration,
retaining only a bounded set of settled Part results. It must not enqueue the
whole page against a slow reader. `Request.signal` and stream `cancel()`
converge on one idempotent cleanup: signal abortable pending work, release
resources, and ignore every later resolution. Finite timeouts have the same
cleanup and bounded Part-failure outcome. Neither loader promises nor host
disconnect signals are assumed universally abortable. Navigation cancellation
discards stale backfills only at the owning point specified in ADR-0159.

Record `Request.signal`, stream cancellation, and deployment close evidence
separately for Nitro Node and Workers. Module-call, simulator, and real
Workers deployment are distinct proof levels; provider/SaaS qualification
does not block the framework candidate.

## Codegen and protocol fixture checklist

- Reject malformed mode/defer lists, missing/thenable undeclared fields,
  compiled-property/params collisions, projector/head resolver,
  computed/transitive dependencies, mixed sinks, shell/head/opaque renderer,
  and unmapped ownership; pin route/field/Part/source diagnostics.
- Pin the generated route-specific field -> signal -> Part/Region manifest,
  program/version binding, and two fields resolving in the opposite order
  from source; show first shell byte before slow resolution.
- Pin exact opt-in, static/non-streaming byte parity, and every matrix row
  for generated GET and POST handlers.
- Pin pre-commit redirects/auth/errors/cookies/status and header-channel
  freeze; held-reference late `append`/`set`/`delete` are no-ops with
  diagnostics, while late redirect is a Part failure.
- Pin ADR-0159 identity, typed seed, text end-anchor, nonce, escaping,
  HTML trust boundary, error, duplicate, no-JS, cancellation, backpressure,
  navigation, and claim fixtures on the **same generated handler**.
- Extend Nitro Node and Workers fixtures with their actual proof level;
  do not infer Bun or real Workers behavior from an ESM import or simulator.

## Constitutional review

- P1/P3: Web `Request`, `Response`, `ReadableStream`, and `AbortSignal` are
  the runtime contract; Nitro is a deployment exit.
- P2: route dependencies and admitted sinks are compiler facts, not runtime
  graph discovery.
- P4: HTTP metadata is final before commitment and no-JS remains usable.
- P6: one Part Program and its existing three executors stay canonical.
- Prior art: streaming SSR can defer content, but this mode backfills
  compiler-owned Parts without server components or island-hydration coupling.
