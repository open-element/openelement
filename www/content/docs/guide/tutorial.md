---
title: 'Tutorial: Your First App'
navLabel: 'Tutorial'
lede: 'Build one small application from an empty directory: create the project, add a page, add an island, add a form action, then build and serve it — with the command and the expected result at every step.'
order: 2
---

> {{SOURCE_LINE_NOTE}} A project created from `@alpha` today therefore comes with that older starter; the steps below teach the baseline authoring surface, the one this guide documents throughout.

## Before you start

You need **Deno 2.9 or newer** and a terminal. Nothing else — no Node.js install, no `package.json`.

The tutorial builds one app in five steps, and every step ends with something you can see:

1. **Create the project** — the starter on disk, running in dev.
2. **Add a page** — a new URL that answers with HTML.
3. **Add an island** — one component that wakes up in the browser.
4. **Add a form action** — a POST that either validates or saves and redirects.
5. **Build and serve** — the `dist/` artifact you deploy.

The TypeScript and TSX blocks on this page are not sketches: CI type-checks them against the framework sources on every commit.

## Step 1: Create the project

```bash
deno run --allow-read --allow-write --allow-env --allow-net --deny-ffi --no-prompt --minimum-dependency-age 0 npm:@openelement/create@alpha my-app
cd my-app
deno task dev
```

`--minimum-dependency-age 0` is needed only because Deno's default (~24 hours) refuses packages published within the last day.

The create CLI prints one `created <path>` line per file, then the next steps:

```text
openElement project created at ./my-app/

  cd my-app
  deno task dev
  See README.md for all tasks (check/build/start/preview)
```

`deno task dev` starts the Vite dev server and prints the URL to open:

```text
  VITE v8.0.16  ready in 412 ms

  ➜  Local:   http://localhost:5173/
```

That page is the starter's home route. Its layout is the whole architecture:

```text
my-app/
  deno.json         import map + tasks: dev, check, test, build, start, preview
  vite.config.ts    design tokens and the openElement Vite plugin
  app/routes/       one file per URL
  app/components/   page elements and their style sheets
  app/islands/      modules that opt into client delivery
  public/           static assets, copied into dist/ as-is
```

`deno task check` type-checks the files named in `deno.json`; when you add a route, add its path to that list too.

## Step 2: Add your first page

A URL is a file: `app/routes/hello.tsx` answers `/hello`. The markup belongs to a compiled element under `app/components/`, so create both files.

`app/components/page-hello.tsx`:

```tsx
// Compiled by the open:compiled-element transform at build time.
import { element, OpenElement } from '@openelement/element';

@element('hello-page', { root: 'light' })
export default class HelloPage extends OpenElement {
  render() {
    return (
      <main>
        <h1>Hello from a page</h1>
        <p>This markup is server-rendered HTML, with no client JavaScript.</p>
      </main>
    );
  }
}
```

`app/routes/hello.tsx`:

```ts
import { definePage } from '@openelement/router';
import HelloPage from '../components/page-hello.tsx';

export default definePage(HelloPage, {
  head: {
    title: 'Hello — my-app',
    description: 'The tutorial page.',
  },
});
```

Two things about that route module are worth knowing now:

- It is a *binding*. The class owns the markup; the route module hands it to `definePage` together with the page's head metadata.
- `definePage` accepts only `route`, `head`, `renderIntent`, `props` and `error`. There is no `render()` field, and no `route.path` — the file name owns the URL.

Expected result: the dev server picks the new files up with no restart. Open http://localhost:5173/hello, or check the response:

```bash
curl -s http://localhost:5173/hello | grep -o 'Hello from a page'
```

```text
Hello from a page
```

The heading was in the HTML the server sent — it is not injected by script. The only client module this page loads is the starter's own `app-shell`; the route itself adds no island.

## Step 3: Add your first island

An island is a module in `app/islands/`. That directory *is* the registration surface: nothing imports it, because the build scans the directory and derives the tag from the file name (`hello-counter.tsx` → `<hello-counter>`).

`app/islands/hello-counter.tsx`:

```tsx
import { defineIslandConfig } from '@openelement/router';
import { element, OpenElement, property } from '@openelement/element';

export const openElement = defineIslandConfig({ hydrate: 'idle', ssr: true, dsd: true });

@element('hello-counter', { root: 'shadow-open' })
export default class HelloCounter extends OpenElement {
  @property({ reflect: false, attribute: false })
  count = 0;

  decrement(): void {
    this.count--;
  }

  increment(): void {
    this.count++;
  }

  render() {
    return (
      <div class='counter-row'>
        <button type='button' onClick={this.decrement}>-</button>
        <span id='count'>{this.count}</span>
        <button type='button' onClick={this.increment}>+</button>
      </div>
    );
  }
}
```

Now host it from the page you already have. `app/components/page-hello.tsx` becomes:

```tsx
import { element, OpenElement } from '@openelement/element';

@element('hello-page', { root: 'light' })
export default class HelloPage extends OpenElement {
  render() {
    return (
      <main>
        <h1>Hello from a page</h1>
        <p>This markup is server-rendered HTML, with no client JavaScript.</p>
        <section class='demo'>
          <p>The server sent this counter's markup; the browser upgrades it on idle.</p>
          <hello-counter></hello-counter>
        </section>
      </main>
    );
  }
}
```

Expected result — reload http://localhost:5173/hello:

- Before any JavaScript runs, the response already contains the counter's markup with `0` in it: the island rendered on the server through the same compiled class.
- Click `+` and `-` and the number changes. `hydrate: 'idle'` told the browser to fetch the island's chunk once the page settled, upgrade the element, and bind the handlers the compiled template declared.
- An island no route references is never delivered — the build derives reachable tags from your route sources, so a module parked in `app/islands/` adds no JavaScript to any page.

## Step 4: Add a form action

A route module can also export `action`. Create the page, then the route that owns the form.

`app/components/page-notes.tsx`:

```tsx
import { element, OpenElement, property } from '@openelement/element';

@element('notes-page', { root: 'light' })
export default class NotesPage extends OpenElement {
  @property({ reflect: false, attribute: false })
  note = '';

  @property({ reflect: false, attribute: false })
  error = '';

  @property({ reflect: false, attribute: false })
  saved = '';

  render() {
    return (
      <main>
        <h1>Notes</h1>
        <form method='post' data-open-enhance>
          <input name='note' type='text' value={this.note} placeholder='Write a note' />
          <button type='submit'>Save</button>
        </form>
        <p id='error'>{this.error}</p>
        <p id='saved'>{this.saved}</p>
      </main>
    );
  }
}
```

`app/routes/notes.tsx`:

```ts
import { definePage, fail, type OpenElementActionFailure, redirect } from '@openelement/router';
import NotesPage from '../components/page-notes.tsx';

interface NotesActionData {
  error?: string;
  note?: string;
}

export function action(ctx: { formData: FormData }): OpenElementActionFailure<NotesActionData> {
  const note = String(ctx.formData.get('note') ?? '').trim();
  if (!note) {
    return fail(422, { error: 'a note is required', note });
  }
  throw redirect(`/notes?saved=${encodeURIComponent(note)}`);
}

export default definePage(NotesPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'Notes — my-app' },
  props({ request, actionData }) {
    const saved = request ? new URL(request.url).searchParams.get('saved') : undefined;
    const result = actionData as NotesActionData | undefined;
    return {
      note: result?.note ?? '',
      error: result?.error ?? '',
      saved: saved ?? '',
    };
  },
});
```

What each part does:

- The form is plain HTML and works without JavaScript. That submission runs `action` on the server; `fail(422, …)` re-renders the same page with the message and the value the user typed.
- `redirect()` answers `303` to a GET URL — post/redirect/get, so reloading the result does not re-post the form.
- `renderIntent: { mode: 'dynamic' }` is deliberate here: the GET reads `?saved=` from the request and must run per request. A page whose GET does not need the request can stay `'static'` and still export an action; only the POST is then handled at request time.
- `props` is the only seam between request scope and the compiled markup. It returns one object, and each key sets the matching `@property` on the page element.

Expected result: `data-open-enhance` submits the form by `fetch` and morphs the returned document into place, so the page does not reload. To see the protocol itself, post to the action directly:

```bash
curl -i -X POST -H 'x-openelement-action: true' --data 'note=' http://localhost:5173/notes
```

```text
HTTP/1.1 422 Unprocessable Entity
content-type: application/problem+json; charset=utf-8
```

```bash
curl -i -X POST -H 'x-openelement-action: true' --data 'note=hello' http://localhost:5173/notes
```

```text
HTTP/1.1 303 See Other
location: /notes?saved=hello
```

Without the `x-openelement-action` header the same POST is an ordinary browser submission and answers HTML instead of JSON. A route can also export `actions` when one form needs several submit buttons, dispatched by `formaction='?/name'`.

## Step 5: Build and serve

```bash
deno task build
```

The build prerenders every static route, bundles one chunk per reachable island, and — because `/notes` is request-time — writes the server entry too. Expected output (trimmed: the starter's own islands appear in the same table, and the per-page list is elided):

```text
== openElement Build Manifest - Phase 3 @ 12:04:31 ==

  Client Islands:
  File                         Size
  --------------------------   --------
  ...
  hello-counter.js             …
  --------------------------   --------
  TOTAL JS                     …

  ...
  All artifacts within budget limits
```

```bash
ls dist
```

The entries this tutorial's work produced:

```text
index.html          prerendered /
hello/index.html    prerendered /hello
404.html            the not-found route
client/islands/     one chunk per reachable island
island-manifests/   page-<hash>.json — which islands each page loads
server/index.js     the request-time handler that answers POST /notes
```

Serve the artifact:

```bash
deno task start
```

```text
[openElement start] request-time server entry loaded (dynamic routes enabled)
[openElement start] http://localhost:4173
```

The port comes from `OPEN_ELEMENT_PORT`, then `PORT`, defaulting to 4173. Verify the artifact rather than the log:

```bash
curl -i http://localhost:4173/hello | head -1
```

```text
HTTP/1.1 200 OK
```

`/hello` is a file on disk; `/notes` reached the server entry. `deno task preview` is the static-only mode and refuses to run while `dist/server` exists — which is why a project with a request-time route is served with `deno task start`.

You now have a project, a page, an island, a form action, and a build you can deploy.

## Next steps

- [Routing and Data](/guide/routing-and-data) — loaders, named actions, and the two loader/action chains.
- [Islands and SSR](/guide/islands-and-ssr) — delivery strategies and what actually ships to the browser.
- [Deployment](/guide/deployment) — the full output contract and the Nitro presets.

## See also

- [Core Concepts](/guide/core-concepts) — the element model behind `@element` and `@property`.
- [Styling](/guide/styling) — where page styles live and what crosses a shadow boundary.
- [Testing](/guide/testing) — the checks worth running against a build.
