---
title: 'Streaming'
lede: 'An opt-in mode that commits the document shell first, then backfills the parts whose data is still loading.'
navLabel: 'Streaming'
order: 45
---

> Accepted for alpha5 ([ADR-0158](https://github.com/open-element/openelement/blob/main/docs/adr/ADR-0158-streaming-server-executor.md), [ADR-0159](https://github.com/open-element/openelement/blob/main/docs/adr/ADR-0159-part-backfill-and-late-claim.md), 2026-09-25); it is an opt-in mode of the compiled server executor, and this page describes the boundary the current implementation enforces.

## What it changes

A `'dynamic'` page normally renders one complete document per request: the loader resolves, the page serializes, the response is sent. Streaming changes only *when* bytes leave the server. The handler settles the decisions that the HTTP response cannot take back — status, redirects, headers, cookies, the resolved document head — flushes the compiled shell, and then backfills the Parts whose loader fields are still resolving.

It is the same compiled program, not a second renderer. There is no runtime JSX, no VNode fallback, and no server-component model. The generated handler still returns a Web `Response` whose body is a `ReadableStream`; Nitro is a deployment exit for that handler.

Two granularities stay independent: the server flushes a shell and backfills Parts in field-resolution order, while islands still activate on `load`, `idle`, `visible`, `media`, or `only`. Neither axis schedules the other, and a streamed page may have no island at all.

### What the streamed shell does not serialize

A streamed shell is rendered by the deferred executor, which admits no nested renderer. Every custom-element tag in the shell — an island that declares `ssr: true, dsd: true`, or any nested compiled component — is therefore emitted as an **opaque empty host**, with its authored light-DOM children preserved and nothing inside it. The `ssr`/`dsd` settings of an island and the normal component serialization rules do not apply on a streaming route: those components activate and render in the browser.

This is a property of the mode, not a configuration you can turn back on, and it is why a streamed page should keep the content that must survive without JavaScript in the page's own shell. See [Web Component Admission Tiers](/architecture/web-component-admission) for what a server-born third-party host may still promise.

## Turning it on

One route declares the mode and names the loader fields it is allowed to defer:

```ts
import { definePage } from '@openelement/router';
import ArticlePage from '../components/page-article.tsx';

export function loader(ctx: { request: Request }) {
  const url = new URL(ctx.request.url);
  return {
    // Front gate: awaited before the shell is committed.
    heading: url.searchParams.get('title') ?? 'Untitled',
    // Deferred: the shell flushes while this Part is still pending.
    body: loadBody(url.searchParams.get('id')),
  };
}

export default definePage(ArticlePage, {
  renderIntent: { mode: 'dynamic', stream: { defer: ['body'] } },
});
```

The deferred field maps by identity onto the page's own compiled property of the same name:

```tsx
import { element, OpenElement, property } from '@openelement/element';

@element('article-page', { root: 'shadow-open' })
export default class ArticlePage extends OpenElement {
  @property({ reflect: false, attribute: false })
  heading = '';

  // Deferrable: writable, non-computed, attribute: false, reflect: false.
  @property({ reflect: false, attribute: false })
  body = '';

  render() {
    return (
      <main>
        <h1>{this.heading}</h1>
        <p id='body'>{this.body}</p>
      </main>
    );
  }
}
```

The declaration is deliberately literal. The build rejects anything it cannot read off the source:

- `stream` is valid only together with `mode: 'dynamic'`.
- `defer` must be a nonempty, duplicate-free list of literal, safe property names — no variables, spreads, or computed keys.
- Each named field must be a declared compiled property that is writable, non-computed, `attribute: false` and `reflect: false`, and must not collide with a route param or `locale`.
- The route descriptor may not carry a custom `props` projector or a request-dependent head, and `renderIntent` must contain only the literal `mode` and `stream` assignments.
- Only native compiled pages are admitted; `defineLitPage` is rejected.

Two project-level constraints are easy to miss. Streaming requires the app shell to be **off for the whole project** (`openElement({ appShell: false })`, no `layouts`): a streamed document is flushed in parts and cannot be wrapped by a shell, so a per-route `route: { layout: false }` does not satisfy the gate. And the loader still returns **one object** — no second loader, no new data shape.

## The front gate decides everything HTTP

Everything that a later byte cannot undo settles before the first chunk: middleware admission, authentication and security checks, CSRF where it applies, route selection, loader setup, every undeferred field, the status/redirect/not-found/error decision, the resolved document head, the header channel merge (including every `Set-Cookie`), the cache policy, and the CSP nonce. Response headers are copied and frozen at that point.

A deferred computation therefore may not own a redirect, a cookie, a response status, or a header decision. After commitment, the framework's own header writes are ignored with a structured late-write diagnostic rather than throwing — headers are immutable once the response is exposed — and a late `redirect()` or status signal is a protocol failure on the Part, not a rewritten response. A pre-commit failure keeps its true status: an opted-in route that redirects, fails auth, or throws before commitment returns its normal response and never a success shell.

Because headers settle before the shell, the usual loader conventions still hold: write session cookies and per-request headers from the loader, and keep any value you would want reflected in the status or headers in the front gate.

## What a deferred field may own

The compiler derives a route-specific manifest from the `defer` list, the compiled property metadata, and the page program's existing signal-to-Part dependencies, then checks every consumer of that signal. A field with any ineligible use is rejected as a whole — there is no partial deferral.

Eligible: anchor-owned **text Parts** and bounded `when`/`each` **Regions**. A Region's item template qualifies only when its dynamic values are wholly owned by that Region and pass the normal serializer escaping.

Not eligible, each rejected with the route, field, source location and the exact offending sink:

- a dependency through a computed signal, including transitive ones;
- an attribute, boolean, class, style, raw HTML, ref, event, or slot-routing sink;
- a shell/layout or head value;
- a host or child opening tag, or any sink whose anchor path crosses a slot or a custom-element host;
- a Region whose item template contains a custom element (an opaque host) or a frame-unsafe tag or attribute;
- an opaque renderer or foreign component wrapper.

The diagnostic names the sink in the form `field -> computed total -> text p3` or `field -> attribute p4`, and the remedy is always one of: keep the field in the front gate, remove the sink, or leave streaming off. Ordinary non-streaming routes are unaffected by any of this.

## The budget

Deferral is bounded, and the bound is mirrored in four places — the build scan, the generated handler, the browser installer, and the public hand-written-manifest executor (`createDeferredDsdExecutor`) — so an over-budget route fails the build instead of failing silently at hydration:

- at most **32 deferred fields** per route;
- at most **64 Part owners** in total across those fields.

A field that owns several Parts counts each of them. Beyond the budget, defer fewer fields, reduce the deferred sinks per field, or split the page.

A third, separate bound applies to the seed: a streamed page's typed seed may carry at most **64 properties**. That is the total number of non-computed properties on the page class, not the number of deferred Parts, so a component with a large property surface can cross it while staying well inside the deferral budget. The seed is rejected whole if it exceeds the cap, which is why the check fails loud during shell construction rather than leaving a page that silently refuses to hydrate.

## With JavaScript

Each settled field emits one inert `<template>` frame per owning Part, carrying the document/program/instance identity tuple, the Part index, the field name, the compiled type, the terminal outcome, and the owned range's HTML. The installer validates the tuple and the route manifest before it touches the DOM, then replaces only the nodes between that Part's anchors — never a whole document or a neighbouring range.

Independent Parts may arrive in either order; the first valid terminal frame for a tuple wins, an identical duplicate is ignored, and a conflicting duplicate is diagnosed and ignored. Frame rejections — unknown Part, wrong request/program/version/instance, unauthorized sink, unsafe markup, bad typed value — produce zero DOM mutations.

The shell also carries inert typed seed data for the page's properties: a tagged resolved value per front-gate property and a tagged pending state per deferred one, with pending Part indices keyed by the full tuple. `null`, missing, and pending are three distinct states; claim consumes the seed before it connects anything, so a pending Part is never compared against a compiled default and never reported as a mismatch. A deferred text Part renders its settled value through the canonical string form, so a field resolving to `null` streams the literal text `null`, and numbers and booleans likewise (`0` streams `0`). That rendering is the current contract, and the owner reserves the right to change it.

A field may own several Parts, in which case every frame for it must carry the same settled value; a differing frame is a protocol conflict and leaves the remaining Parts pending.

## Without JavaScript

The response cannot know whether JavaScript is enabled, so next to each inert frame the server also emits a functional `<noscript>` block, in arrival order, after the shell. With JavaScript the tail is inactive and the installer places content at its anchor; without JavaScript the tail is what the reader sees.

That means the visible position may be later on the page than the pending placeholder, and the shell must not present a pending action as complete. **Exact in-place no-JS ordering is not promised**: if the placement matters, keep the field in the front gate or leave the route non-streaming. Links and forms in the tail keep working — including a plain form POST, which still takes the ordinary non-streaming action path.

The one marker difference is deliberate: in a streaming shell a deferred text Part gets a closing anchor as well as its opening one, so the empty range is well defined. Non-streaming output keeps its existing single-anchor shape, byte for byte.

## Failures after the shell

A deferred failure after commitment is an in-stream outcome and cannot rewrite HTTP metadata: the server already sent its status, headers and cookies. The route emits one terminal error frame for the owning Part — an `error` outcome carrying **no content and no value** — plus the generic replacement text `Content unavailable.` in the no-JS tail. A fatal failure may end the stream, leaving other pending Parts visibly degraded. No later successful value may overwrite an error, and a rejected frame never becomes a successful backfill. Recovery means a new request with a new document token, never an implicit retry frame.

A page's `error` projector and its rendered error variant are the *pre-commit* channel: they answer a failure that happens before the first byte, where the response can still be replaced. Once the shell is committed there is no error page to render inside the stream — only the bounded terminal frame above.

A field that does not settle within the handler's built-in budget — 30 seconds by default — is failed as a timeout and takes the same terminal error path. Cancellation (`Request.signal` abort or stream `cancel()`) converges on one idempotent cleanup: pending work is aborted, resources are released, and every later resolution is ignored.

What is *not* in this boundary: actions, form POSTs, uploads, webhooks, custom API handlers and security rejections keep their existing non-streaming semantics, and an enhanced client-navigation GET does not consume streamed frames. A live streamed document is only superseded when a newer navigation actually takes ownership of intent.

## Third-party Web Components

On a streamed route there is exactly one verified placement for a third-party Custom Element: **server-born inside the streamed shell**. The admission rules above already forbid a deferred sink from crossing a custom-element host, and the backfill path fails closed on foreign custom-element tags in frame content — a third-party component inside a backfill range is not a supported placement.

The qualification probe pins the shape that works: one instance in the shell, upgrading on the client, keeping its server-born light-DOM children, and still interactive after the backfill. Tier status for third-party tags is tracked on [Web Component Admission Tiers](/architecture/web-component-admission) — the corpus currently proves T0 for three tags with server-born light children, and formal T1/T2 qualification remains open.

## With streaming off

Omitting `stream` keeps the existing path exactly as it was. Static pages and dynamic pages without `stream.defer` produce the same bytes they produced before this mode existed — no stream metadata, no seed, no frames, no no-JS tail, and no closing text anchor. Byte parity across the static and non-streaming generation boundaries is pinned by tests, and a route that opts in is the only one whose output changes.

## See also

- [Routing and Data](/guide/routing-and-data) — the loader/props boundary this mode defers parts of.
- [Islands and SSR](/guide/islands-and-ssr) — the server-first baseline and the independent hydration axis.
- [Web Component Admission Tiers](/architecture/web-component-admission) — where a third-party component may live on a streamed route.
- [DSD Rendering](/architecture/dsd) — the shadow-root contract behind the shell.
