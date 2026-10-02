---
title: 'Testing'
lede: 'Use checks that match the changed surface: type checks for routes, build checks for generated output and visual checks for design changes.'
order: 110
---

## Type checks

The generated project wires a single fast signal against the real framework types:

```bash
pnpm check   # tsc --noEmit over the tsconfig include: app/ + vite.config.ts + openelement.config.ts
```

It type-checks every route and component source with the actual `@openelement/*` declarations, so a wrong option on `definePage`, a `props` projector that does not match its loader's data, an unsupported decorator option or a broken import fails here — before any build runs and without a browser.

Loaders and actions are plain functions, which makes them cheap to test directly. One boundary shapes where they live: `pnpm test` runs Node's built-in runner, which loads `.ts` modules by type stripping but cannot load `.tsx` at all — JSX compiles at build time, and every route module's import graph ends in a `.tsx` page component. So keep the loader/action logic you want to unit-test in a `.ts` module under `app/lib/` (a `.ts` file under `app/routes/` would itself be admitted as a route), and re-export it from the route:

```ts
// app/lib/guestbook.ts — plain TypeScript; nothing JSX-shaped imports here
import { fail, redirect, type OpenElementActionFailure } from '@openelement/router';

export interface GuestbookData {
  error?: string;
  note?: string;
}

export function saveNote(ctx: {
  formData: FormData;
}): OpenElementActionFailure<GuestbookData> {
  const note = String(ctx.formData.get('note') ?? '').trim();
  if (!note) return fail(422, { error: 'a note is required', note });
  throw redirect(`/guestbook?saved=${encodeURIComponent(note)}`);
}

export async function listEntries(): Promise<{ entries: string[] }> {
  return { entries: [] };
}
```

```ts
// app/routes/guestbook.ts — the route re-exports the tested functions
import { definePage } from '@openelement/router';
import GuestbookPage from '../components/page-guestbook.tsx';
import { listEntries, saveNote } from '../lib/guestbook.ts';

export { listEntries as loader, saveNote as action };

export default definePage(GuestbookPage, { renderIntent: { mode: 'dynamic' } });
```

The test file imports only the `.ts` module — the validation, the PRG target and the returned data are all decided by plain return values and throws, so nothing in that path needs a server, a DOM or the framework runtime:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { saveNote } from '../app/lib/guestbook.ts';

test('an empty message fails validation', () => {
  const formData = new FormData();
  formData.set('message', '');
  const failure = saveNote({ formData });
  assert.equal(failure.status, 422);
});
```

### Redirects throw

Success does not return — it throws an `OpenElementRedirect` carrying the target and status (the default 302 is coerced to 303 at POST dispatch, PRG), so the test asserts the throw, not a value:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenElementRedirect } from '@openelement/router';
import { saveNote } from '../app/lib/guestbook.ts';

test('a valid message redirects to the echo', () => {
  const formData = new FormData();
  formData.set('message', 'hello');
  let thrown: unknown;
  try {
    saveNote({ formData });
  } catch (error) {
    thrown = error;
  }
  if (!(thrown instanceof OpenElementRedirect)) {
    throw new Error('a valid message must redirect');
  }
  assert.equal(thrown.location, '/guestbook?echoed=hello');
});
```

### Loaders return data

A loader is the same shape — a plain async function, called directly:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { listEntries } from '../app/lib/guestbook.ts';

test('the loader returns the entry list', async () => {
  const data = await listEntries();
  assert.equal(Array.isArray(data.entries), true);
});
```

## Build checks

The build is the second gate, and it is the only place some contracts can be checked — prerendering, route discovery, static-path expansion and the request-time output all happen there:

```bash
pnpm build
pnpm start   # serves dist/; dispatch to dist/server when it exists
```

Inspect the output rather than trusting the log. A pure-static project should produce HTML for every route and no `dist/server` directory at all; a project with a `'dynamic'` route or an action should produce `dist/server/index.js` (the portable `fetch(Request) -> Response` handler) and `dist/server/server-manifest.json` listing the request-time routes. `pnpm start` prints which mode it found, and serves exactly what was built, so a page that looks right in `pnpm dev` but wrong here has a build-time cause.

## Visual checks

Layout, DSD layers and hydration are browser facts. Serve a build (`pnpm start`) and point a browser automation run at it — Playwright and Web Test Runner both drive the built output directly — then assert on the rendered DOM instead of the HTML source: a shadow root's contents are only queryable once the page has parsed, and an upgrade only happens once the island's chunk has loaded.

Two assertions are worth having for any interactive component: the document is complete and styled before the island's module runs (the static-first contract), and after upgrade the component still responds to real user input. The repository's own site suite follows that shape — its end-to-end specs cover DSD layers, hydration behavior, island reactivity and navigation against the built output.

### A first browser smoke

Block the client bundle and the page must still paint — that is the static-first contract in one test:

```ts
import { expect, test } from '@playwright/test';

test('the page paints with its island chunks blocked', async ({ page }) => {
  await page.route('**/client/**', (route) => route.abort());
  await page.goto('http://localhost:4173/');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
});
```

## See also

- [Deployment](/guide/deployment) — what the build emits and how to verify the artifact.
- [Error Handling](/guide/error-handling) — the failure channels these tests assert on.
- [API Routes](/guide/api) — the handler shapes worth testing directly.
