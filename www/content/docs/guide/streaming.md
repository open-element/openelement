---
title: 'Streaming'
lede: 'Deferred-field streaming is not part of this release. This page states what retired, why, and what to do instead.'
navLabel: 'Streaming'
order: 45
---

> **Not available in this release.** `renderIntent.stream` was the class lane's deferred-field channel, and it retired with the class lane. Alpha18 owns the replacement carrier. Do not write it, and do not copy a streaming recipe from an older document: the declaration is refused when the module is evaluated (`OE_PAGE_RENDER_MODE`), so the page will not build.

## What the retired mode was

The accepted design ([ADR-0158](https://github.com/open-element/openelement/blob/main/docs/adr/ADR-0158-streaming-server-executor.md), [ADR-0159](https://github.com/open-element/openelement/blob/main/docs/adr/ADR-0159-part-backfill-and-late-claim.md), 2026-09-25) let a `'dynamic'` page flush its shell first and backfill the loader fields whose values were still resolving. It was never a second renderer: the same compiled program produced the shell and the backfill frames, and the deferred values were welded to the compiled program's **Part owners** — the anchors, text parts and blocks that program declared.

That is exactly why it could not survive. The carrier was the class lane's compiled Part Program. The function lane that replaced the class lane has no Part Program to attach a deferred field to, and no lane produces one now. Authoring therefore refuses the declaration at module evaluation with `OE_PAGE_RENDER_MODE` — "streaming is a compiled-Part-Program channel … and a server function page has none" — instead of accepting a route whose frames nothing could ever serve. (The build keeps a second, later refusal (`OE_ROUTE_SCAN_GENERATED_ELEMENT_PAGE_UNSUPPORTED`) for a generated page that ever gets that far; in practice the authoring check fires first, because both surviving page forms are function components.)

The retired declaration looked like this, and it is shown as history, not as an API:

```text
// REFUSED — this shape does not build in this release.
export default definePage(ArticlePage, {
  renderIntent: { mode: 'dynamic', stream: { defer: ['body'] } },
});
```

No number of fields, no budget rule, no frame protocol and no no-JS tail is documented here, because none of it is reachable. The constants still exported from `@openelement/element` (`STREAM_MAX_FIELDS`, `STREAM_MAX_OWNERS`, `STREAM_TIMEOUT_MS`, …) are the retired executor's own bounds; they describe a carrier this release does not wire into any page.

## What replaces it today

A response is one complete document again: the loader resolves, the page serializes, the response is sent. That is the path every page in this release takes, and it is a supported path, not a degraded one.

**Resolve the data in the loader.** Everything the page needs is awaited before the shell is written. A loader that awaits its own work is the substitution for a deferred field, and it is the honest one: the reader gets a complete document, and there is no second protocol that can leave a range pending.

**Settle HTTP decisions in one place.** Status, redirects, headers, cookies and the resolved document head are decided before the response starts, because there is no longer a point after the first byte at which they could be reconsidered. Session cookies are written from the loader's `responseHeaders` channel; a redirect is thrown from the loader or the action. [Routing and Data](/guide/routing-and-data) states the context each channel gets.

**Keep no-JS content in the page itself.** A page renders one shell with the content it has. If a section must be readable without JavaScript, it must be part of that render — an island that hydrates later is an enhancement on top of content that is already there, never a placeholder for it. Islands still activate independently on `load`, `idle`, `visible`, `media` or `only`, and that axis never depended on streaming.

**Use the error projector for failures before the response.** `definePage(Component, { error })` is the channel that can still change the status line and re-render the page with an error variant. Once a response starts there is no such channel, which is another reason this release commits the response in one piece. [Error Handling](/guide/error-handling) covers the projector, `fail()`, `redirect()` and `notFound()`.

## What is not claimed

The replacement is **not** an incremental backfill under a different name. Nothing in this release:

- emits inert frames or typed seed data after the shell;
- installs a Part-range claim on the client;
- admits a `<noscript>` tail for late-arriving content;
- bounds or times out a deferred field.

A reader looking for those guarantees is looking at a future release. Alpha18 owns the carrier; this page will be rewritten when one exists, and until then it will not teach an API that throws.

## See also

- [Routing and Data](/guide/routing-and-data) — the loader/props boundary a page uses instead.
- [Islands and SSR](/guide/islands-and-ssr) — the hydration axis, which is independent of streaming and unchanged.
- [Error Handling](/guide/error-handling) — the failure channels that survive, and the boundary of each.
- [DSD Rendering](/architecture/dsd) — the shadow-root contract every page renders through.
