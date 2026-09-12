---
title: 'Routing and Data'
lede: 'Routes are file-based surfaces with explicit metadata and data boundaries.'
order: 40
---

## File routes

Routes should be discoverable from the repository tree. A `definePage` route default-exports the compiled page element class wrapped in `definePage(PageClass, { ... })`; the page class lives in a non-route module (for example `app/components/`) and owns the markup as its compiled render program. A route may still export `tagName` to name a content element (#960), but on a `definePage` route that export names the content element only and never drives page registration: the page itself always registers under the route-path tag (`app/routes/index.tsx` becomes `index-page`). Generated build entries register every admitted route and island class — route modules never self-register.

## Metadata

Navigation and generated docs rely on route metadata.

## Data boundary

Keep data loading separate from presentation markup.

## Rendering modes

`renderIntent.mode` selects where a page renders: `'static'` (default) prerenders at build; `'dynamic'` skips prerendering and renders per request through the generated `dist/server` entry, running the route loader on every request. Pages that export an action must declare `'dynamic'` — the build rejects prerendered action pages. This behavior is frozen under ADR-0122.

## Form actions

A dynamic route may export an `action({ formData })` — plain HTML forms work without JavaScript: validation failures return `fail(4xx, data)` and re-render with the echo at `fail()`'s status (conventionally 422), successes answer 303 (PRG). Named actions dispatch via `formaction='?/name'`. Forms marked `data-open-enhance` submit via fetch and morph the returned document into place: hydrated islands whose light DOM did not change keep their state, `data-open-preserve` exempts a subtree, and the URL follows the PRG target. An action must be safe to re-run after a failed validation; these application-loop semantics are frozen under ADR-0122.

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
} from '@openelement/app';
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

Fetch-based action posts are recognized by the `x-openelement-action` header (exported as `ACTION_FETCH_HEADER` from `@openelement/app`): the built-in morph enhancement sends `enhance` and receives the same full-HTML responses as the no-JS path; a programmatic caller sends `true` and receives the serialized `ActionResult` union — `success` / `failure` / `redirect` with `status` and `data` — while error outcomes answer RFC 9457 `problem+json` (`type`/`title`/`status`/`detail`, #863). No header means a plain browser form post.

## Two loader/action chains

Request-time (`'dynamic'`) loaders/actions run on the server with the Web-standard context `{ request, params, env, platform, route, responseHeaders }` and the `fail()`/`redirect()` protocol. `responseHeaders` (ADR-0129) is a mutable `Headers` channel merged into every response of the request — renders, redirects, 422 re-renders and fetch-channel JSON alike — so recipes can write session cookies; framework protocol headers always win on conflict. SPA-mode loaders/actions run client-side with only `{ params }` (plus `formData` for actions) and signal failure by throwing — a throw is normalized into action data. The names are intentionally parallel, but the contexts differ: code written against one chain cannot assume the other's context (#570, ADR-0119 frozen SPA semantics).

### Integration recipes

[better-auth](https://github.com/open-element/openelement/blob/main/docs/integrations/better-auth.md) — session read in loaders, auth endpoints mounted as API routes, authorization in actions (doc-level recipe).

[Drizzle](https://github.com/open-element/openelement/blob/main/docs/integrations/drizzle.md) — queries in loaders, mutations in actions, connection secrets on `ctx.env` only (doc-level recipe).

[Validation (zod / valibot)](https://github.com/open-element/openelement/blob/main/docs/integrations/validation.md) — schema parse inside the action, `fail(422)` with the echo on failure; verified by the request-time fixture e2e gate.

[Rate limit (fetch middleware)](https://github.com/open-element/openelement/blob/main/docs/integrations/rate-limit.md) — fixed-window per-IP limiting on `middleware.use`, scoped to action POSTs, 429 `problem+json` over the limit; verified against a scratch app built from repo source.

[FileDataAdapter (filesystem data)](https://github.com/open-element/openelement/blob/main/docs/integrations/file-data-adapter.md) — the ADR-0095 recipe: a read-only JSON-file adapter with the unstorage read surface (`getItem`/`keys`), used from loaders; verified against a scratch app built from repo source.

[Auth guard (better-auth middleware)](https://github.com/open-element/openelement/blob/main/docs/integrations/better-auth-guard.md) — redirects anonymous users out of a protected route group (303) and passes session identity through to loaders; guard mechanics verified, better-auth call stubbed.

[Supabase (reference starter)](https://github.com/open-element/openelement/blob/main/docs/integrations/supabase.md) — `@supabase/ssr` server client writing session cookies over the ADR-0129 response-header channel, authorization re-checked in loaders/actions, RLS-first notes / Storage / Realtime; every code block lifted from `examples/supabase-cloudflare-starter` and qualified against a real Supabase project.
