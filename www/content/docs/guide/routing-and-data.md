---
title: 'Routing and Data'
lede: 'Routes are file-based surfaces with explicit metadata and data boundaries.'
order: 40
---

## File routes

Routes should be discoverable from the repository tree. There are two page forms, and the file name owns the URL in both:

- A page whose markup is static text (or props only) is a **server function page**: the route module exports the component itself and default-exports `definePage(Component, descriptor?)`. The compiler lowers the function into a generative HTML constructor, so the page is server-only by construction.
- A page that needs state, handlers or lifecycle imports a component from a non-route module (for example `app/components/`) and default-exports `definePage(PageComponent, { ... })`.

A page root must be a **shadow** component: the compiler-emitted DSD host producer is what a generated page root renders through, and a light root has none — so a light page takes the server-function form instead. Generated build entries register every admitted route and island class — route modules never self-register, and a `tagName` export never drives page registration.

## Metadata

Navigation and generated docs rely on route metadata, and a route declares it in exactly one place depending on what the route *is*.

A **content page** declares it in Markdown frontmatter: `title` (required), `lede`, `order` (required, sorts within its section), `section` (the sidebar group, defaulted per collection), and optional `navLabel` when the sidebar label should differ from the title. A `zh` sibling supplies its own translated values from the same fields. The site's nav generator reads frontmatter through the same loader and schema the page body uses, so the sidebar cannot describe a page differently from the page itself.

A **code route** declares `export const meta = { section, label, order }` in the route module — `section` groups it in the sidebar, `label` is the short nav label, `order` sorts within the group. A section name that no basePath lists in the site's section map fails the nav generation rather than silently dropping the group from that page's sidebar. Routes with no `meta` and no frontmatter are simply absent from the sidebar; they are still routed.

Document metadata — the head of the page — is separate from navigation metadata. `definePage(PageComponent, { head })` declares the document title, description, canonical path and structured data, either as a static object or as a resolver receiving the same request-scoped context the props projector gets. The resolver must stay a pure function of that context: the Document seam resolves it per render and never fetches, caches, or schedules loaders on its own. For content pages, title and lede come from the render locale's frontmatter with the English original as the fallback, so a page whose translation is missing a field still answers with a complete head.

Neither kind of metadata is markup: nothing here renders into the page body.

## Data boundary

Keep data loading separate from presentation markup. The boundary is explicit and narrow: a loader returns data, `definePage`'s `props` projector maps that data onto the page's **declared properties**, and the component's body reads those properties as ordinary typed props.

A route loader runs server-side for a `'dynamic'` page (or at build time for a `'static'` one, once per `getStaticPaths()` entry) and returns a plain value; it is never handed the element and never touches the DOM. The props projector is the single deterministic seam between request scope and the component — it receives `{ data, actionData, params, request, route, meta }` (plus `locale` when i18n is configured) and returns the properties the page declared, so the same projection runs for the static artifact, the request-time server and the SPA bootstrap. Omit `props` and the default projection applies: route params first, then the loader-data record's own entries, with dangerous keys filtered so a hostile payload cannot re-prototype the projection. Extra entries are ignored, because the compiled serializer consumes only the properties the page declared.

Every property a projector intends to write must exist as a sidecar `properties` row, with a type that can hold the projected value. Only `string`, `number` and `boolean` rows have an attribute channel; an array or object row must declare `attribute: false` and arrive through the projector, which is exactly why the props channel rather than the attribute channel is the interesting one here.

That separation is what makes the two chains interchangeable and the markup testable: a page's compiled render depends on nothing but its props, so it can be serialized at build time, re-rendered per request, or created in the browser from the same data. It is also the seam where the failure channels attach — an expected validation failure arrives as `actionData`, not as an exception, and `fail()`'s echo re-enters the page through the same projector.

Two consequences worth writing down: never let a loader return a DOM node, a class instance or anything the serializer would have to guess at (props are projected, not serialized); and never read the request directly from the component body (a compiled component has no request scope — everything it may render must pass through the projector).

## Rendering modes

`renderIntent.mode` selects where a page renders: `'static'` (default) prerenders at build; `'dynamic'` skips prerendering and renders per request through the generated `dist/server` entry, running the route loader on every request. A page that exports an action may stay `'static'` — a hybrid page: its GET is prerendered and served from the static artifact, while its action POST is dispatched to the generated server entry at request time. Choose `'dynamic'` when the GET itself must run per request (per-request loaders, response headers, non-repeatable content). This behavior is frozen.

Pages send a complete HTML response. Resolve page data in the loader before rendering, and set headers or cookies through the loader’s `responseHeaders` channel. Include content needed without JavaScript in the server render.

## Server function pages

When a page is one-shot static text — a legal notice, a landing section — the compiled-component machinery is more than it needs. A **server function page** is the route module's own exported TSX component function wrapped in `definePage(Component, descriptor?)`: the compiler lowers the function into a generative HTML constructor (the same semantic checks and the same escaping as every compiled component — text crosses one escape channel, attributes another), and the render output is server-only by construction. A server function page produces no compiled program, no property state machinery, and never reaches the island, static-component, or client-chunk surfaces; the function itself adds no client module, while the application may still load a shared bootstrap for layout or island delivery.

```tsx
// app/routes/about.tsx
import { definePage } from '@openelement/router';

export const loader = async () => ({ title: 'About' });

export function AboutPage(props: { title: string }) {
  return <main><h1>{props.title}</h1></main>;
}

export default definePage(AboutPage, { head: { title: 'About' } });
```

The component function must be an exported declaration of THIS module passed by identifier — an inline arrow or an unexported local is outside the compiler grammar (runtime JSX has no interpreter). Dynamic text interpolates through JSX (`{props.title}`) and is escaped by the compiler; `props.children` is the compiler-owned composition channel (a caller's JSX children arrive as final HTML), and a loader payload carrying a `children` key is refused before the render runs rather than injected.

This is also the form a **light page** uses. A light root has no compiled DSD host producer for a generated page root to render through, so the route declares its own component, and that component's markup is document content — a plain `<main>`, styled by the document and by the page's declared sheet. It is also the form a page uses when its markup must stay out of a shadow boundary at all.

Everything around the page stays the same as the component route path: the loader runs and the `props` projector (or the default projection) builds the props record; the render output flows through the same renderer wraps, layout wrap, and document wrap — so the HTTP/DSD contract, the head resolution, the redirect/not-found channels, and the error projector's 500 re-render (which hands the error-projected props to the same render function) behave exactly as they do for a component page.

## Form actions

A route may export an `action({ formData })` — plain HTML forms work without JavaScript: validation failures return `fail(4xx, data)` and re-render with the echo at `fail()`'s status (conventionally 422), successes answer 303 (PRG). Named actions dispatch via `formaction='?/name'`. Forms marked `data-open-enhance` submit via fetch and morph the returned document into place: hydrated islands whose light DOM did not change keep their state, `data-open-preserve` exempts a subtree, and the URL follows the PRG target. An action must be safe to re-run after a failed validation; these application-loop semantics are frozen.

### app/components/page-guestbook.tsx

```tsx
// A page-assembled component: the markup owns the form, the route owns the data.
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'guestbook-page',
  // A page root is a shadow root: the compiler's DSD host producer is what
  // renders it on the server, and a light root has no producer.
  root: 'shadow',
  properties: {
    // Array rows have no attribute wire, so the projector is their only channel.
    entries: { attribute: false, default: [] },
    message: { attribute: false, default: '' },
    error: { attribute: false, default: '' },
    echoed: { attribute: false, default: '' },
  },
});

export default function GuestbookPage(props: {
  entries: Array<{ id: string; text: string }>;
  message: string;
  error: string;
  echoed: string;
}) {
  return (
    <main>
      <h1>guestbook</h1>
      <form method='post' data-open-enhance>
        <input name='message' type='text' value={props.message} />
        <button type='submit'>Send</button>
        <button type='submit' formaction='?/shout'>Shout</button>
      </form>
      {props.error ? <p role='alert' data-message={props.error}>{props.error}</p> : null}
      {props.echoed ? <p data-echoed={props.echoed}>Saved.</p> : null}
      <ul>{props.entries.map((entry) => <li key={entry.id}>{entry.text}</li>)}</ul>
    </main>
  );
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
  entries: Array<{ id: string; text: string }>;
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
// onto the page's declared properties.
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

**Success data has no envelope — it travels through the PRG target.** The `actionData` in the context above is the payload of a RETURNED failure (`fail(status, data)`) and nothing else. A successful action answers 303 (PRG), so the projector runs again on the redirected GET — exactly where a no-JS submission lands — and the success state to show is whatever that GET can read: the loader's re-run and the PRG target's own query state. The `echoed` value above is that pattern; a loader-side read is the other half:

```ts
// The redirected GET re-runs the loader: success state arrives here, not
// through a success envelope on the POST.
export async function loader(ctx: { request: Request }): Promise<GuestbookData> {
  const posted = new URL(ctx.request.url).searchParams.get('posted');
  return { entries: await listEntries(), posted: posted ?? '' };
}
```

This is ADR-0120's three-state status rule, frozen: a successful non-GET action answers 303, an action endpoint never answers 200 with a success document, and validation stays a `fail(4xx)` return. The rule is about the NATIVE channel's status line — on the fetch channel the same success is HTTP **200** whose body is the `redirect` ActionResult (`{ type: 'redirect', status: 303, location }`), and the 303 is the value inside that body rather than the status of the response. The built-in enhancement follows it as a navigation; a programmatic caller reads it as data.

## Action fetch negotiation

Fetch-based action posts are recognized by the `x-openelement-action` header (exported as `ACTION_FETCH_HEADER` from `@openelement/router`): the built-in morph enhancement sends `enhance` and receives the same full-HTML responses as the no-JS path; a programmatic caller sends `true` and receives the serialized `ActionResult` union — `failure` with `status`/`data`, or `redirect` with the PRG `status`/`location`. A validation failure comes back as `422` with `application/json` and the `failure` shape — the author's status and data, not a document. `application/problem+json` (`type`/`title`/`status`/`detail`) is the channel's PROTOCOL-error shape instead: a rejected cross-site post, an unknown action, an unparseable body. No header means a plain browser form post.

## Two loader/action chains

Request-time (`'dynamic'`) loaders/actions run on the server with the Web-standard context `{ request, params, env, platform, route, responseHeaders }` and the `fail()`/`redirect()` protocol. `responseHeaders` is a mutable `Headers` channel merged into every response of the request — renders, redirects, 422 re-renders and fetch-channel JSON alike — so recipes can write session cookies; framework protocol headers always win on conflict. SPA-mode loaders/actions run client-side with `{ params, searchParams, signal }` (a `URLSearchParams` and an `AbortSignal`, plus `formData` for actions) and signal failure by throwing — a throw is normalized into action data. The names are intentionally parallel, but the contexts differ: code written against one chain cannot assume the other's context.

### Integration recipes

[Validation (zod / valibot)](https://github.com/open-element/openelement/blob/main/docs/integrations/validation.md) — schema parse inside the action, `fail(422)` with the echo on failure; verified by the request-time fixture e2e gate.

[Rate limit (fetch middleware)](https://github.com/open-element/openelement/tree/main/apps/saas#status-working-product) — fixed-window per-IP limiting (`apps/saas/lib/rate-limit.ts`), scoped to action POSTs, 429 `problem+json` over the limit; covered by the SaaS test suite.

[Supabase (first-party SaaS)](https://github.com/open-element/openelement/tree/main/apps/saas) — `@supabase/ssr` server client writing session cookies over the response-header channel, authorization re-checked in loaders/actions, RLS-first notes / Storage / Realtime; implemented in `apps/saas` and covered by its test suite.

## See also

- [Core Concepts](/guide/core-concepts) — the components and islands these routes compose.
- [Error Handling](/guide/error-handling) — the failure channels an action's return value feeds.
- [API Routes](/guide/api) — routes that answer requests without pages.
