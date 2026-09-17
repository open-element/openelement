---
title: 'Testing'
lede: 'Use checks that match the changed surface: type checks for routes, build checks for generated output and visual checks for design changes.'
order: 110
---

## Type checks

The generated project wires a single fast signal against the real framework types:

```bash
deno task check   # deno check --config deno.json app/ vite.config.ts
```

It type-checks every route and component source with the actual `@openelement/*` declarations, so a wrong option on `definePage`, a `props` projector that does not match its loader's data, an unsupported decorator option or a broken import fails here — before any build runs and without a browser.

Loaders and actions are plain functions, which makes them cheap to test directly. Import the route module in a `deno test` file, call the loader with a `Request` or the action with a `FormData`, and assert on the returned value: a success object, an `OpenElementActionFailure` from `fail()` (its `status` and `data` fields), or a thrown `redirect()`/`notFound()`.

```ts
import { assertEquals } from '@std/assert';
import { action } from '../app/routes/guestbook.tsx';

Deno.test('an empty message fails validation', () => {
  const formData = new FormData();
  formData.set('message', '');
  const failure = action({ formData });
  assertEquals(failure.status, 422);
});
```

Nothing in that path needs a server, a DOM or the framework runtime: the validation, the echo and the PRG target are all decided by the function's return value.

## Build checks

The build is the second gate, and it is the only place some contracts can be checked — prerendering, route discovery, static-path expansion and the request-time output all happen there:

```bash
deno task build
deno task start   # serves dist/; dispatch to dist/server when it exists
```

Inspect the output rather than trusting the log. A pure-static project should produce HTML for every route and no `dist/server` directory at all; a project with a `'dynamic'` route or an action should produce `dist/server/index.js` (the portable `fetch(Request) -> Response` handler) and `dist/server/server-manifest.json` listing the request-time routes. `deno task start` prints which mode it found, and serves exactly what was built, so a page that looks right in `deno task dev` but wrong here has a build-time cause.

## Visual checks

Layout, DSD layers and hydration are browser facts. Serve a build (`deno task start`) and point a browser automation run at it — Playwright and Web Test Runner both drive the built output directly — then assert on the rendered DOM instead of the HTML source: a shadow root's contents are only queryable once the page has parsed, and an upgrade only happens once the island's chunk has loaded.

Two assertions are worth having for any interactive component: the document is complete and styled before the island's module runs (the static-first contract), and after upgrade the component still responds to real user input. The repository's own site suite follows that shape — its end-to-end specs cover DSD layers, hydration behavior, island reactivity and navigation against the built output.

## See also

- [Deployment](/guide/deployment) — what the build emits and how to verify the artifact.
- [Error Handling](/guide/error-handling) — the failure channels these tests assert on.
- [API Routes](/guide/api) — the handler shapes worth testing directly.
