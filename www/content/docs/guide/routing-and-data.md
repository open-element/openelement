---
title: 'Routing and Data'
lede: 'Routes are file-based surfaces with explicit metadata and data boundaries.'
order: 40
---

## File routes

Routes should be discoverable from the repository tree. A `definePage` route default-exports the compiled page element class wrapped in `definePage(PageClass, { ... })`; the page class lives in a non-route module (for example `app/components/`) and owns the markup as its compiled render program. A route may still export `tagName` to name a content element, but on a `definePage` route that export names the content element only and never drives page registration: the page itself registers under its compiled class's `@element(tag)` — SSR resolves the tag from the compiled Part Program — with the route-path-derived tag (`app/routes/index.tsx` → `index-page`) only as a fallback. Generated build entries register every admitted route and island class — route modules never self-register.

## Metadata

Navigation and generated docs rely on route metadata, and a route declares it in exactly one place depending on what the route *is*.

A **content page** declares it in Markdown frontmatter: `title` (required), `lede`, `order` (required, sorts within its section), `section` (the sidebar group, defaulted per collection), and optional `navLabel` when the sidebar label should differ from the title. A `zh` sibling supplies its own translated values from the same fields. The site's nav generator reads frontmatter through the same loader and schema the page body uses, so the sidebar cannot describe a page differently from the page itself.

A **code route** declares `export const meta = { section, label, order }` in the route module — `section` groups it in the sidebar, `label` is the short nav label, `order` sorts within the group. A section name that no basePath lists in the site's section map fails the nav generation rather than silently dropping the group from that page's sidebar. Routes with no `meta` and no frontmatter are simply absent from the sidebar; they are still routed.

Document metadata — the head of the page — is separate from navigation metadata. `definePage(PageClass, { head })` declares the document title, description, canonical path and structured data, either as a static object or as a resolver receiving the same request-scoped context the props projector gets. The resolver must stay a pure function of that context: the Document seam resolves it per render and never fetches, caches, or schedules loaders on its own. For content pages, title and lede come from the render locale's frontmatter with the English original as the fallback, so a page whose translation is missing a field still answers with a complete head.

Neither kind of metadata is markup: nothing here renders into the page body.

## Data boundary

Keep data loading separate from presentation markup. The boundary is explicit and narrow: a loader returns data, `definePage`'s `props` projector maps that data onto the page's compiled properties, and the page's `render()` reads only `this.<property>`.

A route loader runs server-side for a `'dynamic'` page (or at build time for a `'static'` one, once per `getStaticPaths()` entry) and returns a plain value; it is never handed the element and never touches the DOM. The props projector is the single deterministic seam between request scope and the compiled page — it receives `{ data, actionData, params, request, route, meta }` (plus `locale` when i18n is configured) and returns the properties the page declared, so the same projection runs for the static artifact, the request-time server and the SPA bootstrap. Omit `props` and the default projection applies: route params first, then the loader-data record's own entries, with dangerous keys filtered so a hostile payload cannot re-prototype the projection. Extra entries are ignored, because the compiled serializer consumes only the properties the page declared.

That separation is what makes the two chains interchangeable and the markup testable: a page's compiled render program depends on nothing but its properties, so it can be serialized at build time, re-rendered per request, or created in the browser from the same data. It is also the seam where the failure channels attach — an expected validation failure arrives as `actionData`, not as an exception, and `fail()`'s echo re-enters the page through the same projector.

Two consequences worth writing down: never let a loader return a DOM node, a class instance or anything the serializer would have to guess at (props are projected, not serialized); and never read the request directly from `render()` (a compiled page has no request scope — everything it may render must pass through the projector).

## Rendering modes

`renderIntent.mode` selects where a page renders: `'static'` (default) prerenders at build; `'dynamic'` skips prerendering and renders per request through the generated `dist/server` entry, running the route loader on every request. A page that exports an action may stay `'static'` — a hybrid page: its GET is prerendered and served from the static artifact, while its action POST is dispatched to the generated server entry at request time. Choose `'dynamic'` when the GET itself must run per request (per-request loaders, response headers, non-repeatable content). This behavior is frozen.

## Form actions

A route may export an `action({ formData })` — plain HTML forms work without JavaScript: validation failures return `fail(4xx, data)` and re-render with the echo at `fail()`'s status (conventionally 422), successes answer 303 (PRG). Named actions dispatch via `formaction='?/name'`. Forms marked `data-open-enhance` submit via fetch and morph the returned document into place: hydrated islands whose light DOM did not change keep their state, `data-open-preserve` exempts a subtree, and the URL follows the PRG target. An action must be safe to re-run after a failed validation; these application-loop semantics are frozen.

### app/components/page-guestbook.tsx

```tsx
// Compiled by the open:compiled-element transform.
import { element, OpenElement, property } from '@openelement/element';

@element('guestbook-page', { root: 'shadow-open' })
export default class GuestbookPage extends OpenElement {
  @property({ reflect: false, attribute: false })
  entries: string[] = [];

  @property({ reflect: false, attribute: false })
  message = '';

  @property({ reflect: false, attribute: false })
  error = '';

  @property({ reflect: false, attribute: false })
  echoed = '';

  render() {
    return (
      <main>
        <h1>guestbook</h1>
        <form method='post' data-open-enhance>
          <input name='message' type='text' value={this.message} />
          <button type='submit'>Send</button>
          <button type='submit' formaction='?/shout'>Shout</button>
        </form>
        {this.error ? <p role='alert'>{this.error}</p> : <span></span>}
        {this.echoed ? <p>echo={this.echoed}</p> : <span></span>}
        <ul>{this.entries.map((entry) => <li>{entry}</li>)}</ul>
      </main>
    );
  }
}
```

### app/routes/guestbook.tsx

```ts
import {
  definePage,
  fail,
  type OpenElementActionFailure,
  redirect,
} from '@openelement/router';
import GuestbookPage from '../components/page-guestbook.tsx';

interface GuestbookData {
  entries: string[];
}

interface GuestbookActionData {
  error?: string;
  message?: string;
}

export async function loader(): Promise<GuestbookData> {
  return { entries: await listEntries() }; // app data layer
}

export function action(
  ctx: { formData: FormData },
): OpenElementActionFailure<GuestbookActionData> {
  const message = String(ctx.formData.get('message') ?? '').trim();
  if (!message) {
    return fail(422, { error: 'message is required', message });
  }
  throw redirect('/guestbook?echoed=' + encodeURIComponent(message)); // 303 PRG
}

// Named actions dispatch via formaction='?/name'.
export const actions = {
  shout(ctx: { formData: FormData }): never {
    const message = String(ctx.formData.get('message') ?? '').trim() || 'silence';
    throw redirect('/guestbook?echoed=' + encodeURIComponent(message.toUpperCase()));
  },
};

// The props projector is the single deterministic seam mapping request scope
// onto the compiled page properties.
export default definePage(GuestbookPage, {
  renderIntent: { mode: 'dynamic' },
  props({ data, actionData, request }) {
    const action = actionData as GuestbookActionData | undefined;
    const echoed = request ? new URL(request.url).searchParams.get('echoed') : undefined;
    return {
      entries: data?.entries ?? [],
      message: action?.message ?? '',
      error: action?.error ?? '',
      echoed: echoed ?? '',
    };
  },
});
```

## Action fetch negotiation

Fetch-based action posts are recognized by the `x-openelement-action` header (exported as `ACTION_FETCH_HEADER` from `@openelement/router`): the built-in morph enhancement sends `enhance` and receives the same full-HTML responses as the no-JS path; a programmatic caller sends `true` and receives the serialized `ActionResult` union — `success` / `failure` / `redirect` with `status` and `data` — while error outcomes answer RFC 9457 `problem+json` (`type`/`title`/`status`/`detail`). No header means a plain browser form post.

## Two loader/action chains

Request-time (`'dynamic'`) loaders/actions run on the server with the Web-standard context `{ request, params, env, platform, route, responseHeaders }` and the `fail()`/`redirect()` protocol. `responseHeaders` is a mutable `Headers` channel merged into every response of the request — renders, redirects, 422 re-renders and fetch-channel JSON alike — so recipes can write session cookies; framework protocol headers always win on conflict. SPA-mode loaders/actions run client-side with `{ params, searchParams, signal }` (a `URLSearchParams` and an `AbortSignal`, plus `formData` for actions) and signal failure by throwing — a throw is normalized into action data. The names are intentionally parallel, but the contexts differ: code written against one chain cannot assume the other's context.

### Integration recipes

[Validation (zod / valibot)](https://github.com/open-element/openelement/blob/main/docs/integrations/validation.md) — schema parse inside the action, `fail(422)` with the echo on failure; verified by the request-time fixture e2e gate.

[Rate limit (fetch middleware)](https://github.com/open-element/openelement/tree/main/apps/saas#status-working-product) — fixed-window per-IP limiting (`apps/saas/lib/rate-limit.ts`), scoped to action POSTs, 429 `problem+json` over the limit; covered by the SaaS test suite.

[Supabase (first-party SaaS)](https://github.com/open-element/openelement/tree/main/apps/saas) — `@supabase/ssr` server client writing session cookies over the response-header channel, authorization re-checked in loaders/actions, RLS-first notes / Storage / Realtime; implemented in `apps/saas` and covered by its test suite.

## See also

- [Core Concepts](/guide/core-concepts) — the elements and islands these routes compose.
- [Error Handling](/guide/error-handling) — the failure channels an action's return value feeds.
- [API Routes](/guide/api) — routes that answer requests without pages.
