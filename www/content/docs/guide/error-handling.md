---
title: 'Error Handling'
lede: 'Error handling preserves platform semantics and keeps route failures visible.'
order: 80
---

## fail(): the return channel

Expected action failures return, never throw: `fail(status, data)` requires a 4xx status and produces an `OpenElementActionFailure`. The server answers with the `fail()` status (conventionally 422), the page re-rendered and the submitted values echoed; the page descriptor's `props` projector reads the failure from its context's `actionData` and maps it onto the page's declared properties. `isActionFailure()` is the duck-typed guard. Enhanced forms morph only 200/422 responses: a non-422 4xx fails over to a full navigation — the failure echo is lost on that path, so keep validation failures at 422.

## redirect() and notFound()

Control flow throws: `redirect(location, status)` throws `OpenElementRedirect` — the status is restricted to 301/302/303/307/308, and every 3xx is coerced to 303 in the POST action context (PRG); `notFound(message)` throws `OpenElementNotFound` (404). `isOpenElementRedirect()` and `isOpenElementNotFound()` match by shape, so the guards survive serialization boundaries.

## The error projector

`definePage(PageComponent, { error })` declares the page-level error projector: it receives the caught `error` plus the render context and returns the error variant of the page's declared properties (the generated entry re-renders the page with those props and status 500); without it the generic status page answers. `notFound()` and unexpected loader/action throws land here; on the SPA chain a throw is normalized into the same channel instead of silently replacing loader data. On the programmatic action channel (`x-openelement-action: true`), error outcomes answer RFC 9457 Problem Details (`application/problem+json` with `type`/`title`/`status`/`detail`) instead of a bespoke JSON envelope; this wire shape is frozen.

### app/components/page-post.tsx

```tsx
// A page-assembled component: the route owns the data, this module owns the markup.
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'post-page',
  // A page root is a shadow root: the compiler's DSD host producer renders it,
  // so even the error variant is part of the very first response.
  root: 'shadow',
  properties: {
    // One row per projector key, every one attribute-free: the props projector
    // writes them, and nothing of theirs should reach a host attribute.
    title: { attribute: false, default: '' },
    error: { attribute: false, default: '' },
    status: { attribute: false, default: 0 },
  },
});

export default function PostPage(props: { title: string; error: string; status: number }) {
  return (
    <main>
      {props.status
        ? <h1 data-status={props.status}>Request failed</h1>
        : (
          <form method='post' data-open-enhance>
            <input name='title' value={props.title} />
            <button type='submit'>Save</button>
          </form>
        )}
      {props.error ? <p role='alert' data-message={props.error}>{props.error}</p> : null}
    </main>
  );
}
```

A conditional branch admits a JSX element or `null`, which is why each branch above is an element and the "no error" case is `null` rather than a bare string (a text-valued branch fails closed with `OEC9042`). The error variant is an ordinary part of the same compiled markup — there is no second error page and no runtime JSX path.

### app/routes/posts/[id].tsx

```ts
import {
  definePage,
  fail,
  isOpenElementNotFound,
  notFound,
  type OpenElementActionFailure,
  redirect,
} from '@openelement/router';
import PostPage from '../../components/page-post.tsx';

interface PostActionData {
  error?: string;
  title?: string;
}

export async function loader({ params }: { params: Record<string, string> }) {
  const post = await findPost(params.id); // app data layer
  if (!post) notFound('no such post'); // throws OpenElementNotFound (404)
  return { post };
}

export function action(ctx: { formData: FormData }): OpenElementActionFailure<PostActionData> {
  const title = String(ctx.formData.get('title') ?? '').trim();
  if (title.length < 3) {
    // Expected failure: RETURN fail(4xx, data) — 422 re-render with the echo.
    return fail(422, { error: 'title is too short', title });
  }
  // Success: throw redirect() — coerced to 303 (PRG) in the POST context.
  throw redirect('/posts?saved=1');
}

export default definePage(PostPage, {
  renderIntent: { mode: 'dynamic' },
  props({ data, actionData }) {
    const post = data as { title?: string } | undefined;
    const action = actionData as PostActionData | undefined;
    // The projector is the only seam: one object, one key per declared row.
    return {
      title: action?.title ?? post?.title ?? '',
      error: action?.error ?? '',
    };
  },
  error(err) {
    // notFound() and unexpected throws land on the error projector.
    return { status: isOpenElementNotFound(err) ? 404 : 500 };
  },
});
```

`redirect()` also takes an explicit status (301/302/303/307/308); any other status is rejected at call time. The same guards work on the SPA chain, but SPA loaders/actions receive `{ params, searchParams, signal }` (plus `formData` for actions).

## In the browser: the onError intrinsic

The **route** channels above decide what the server answers. The **component** channel is separate and much narrower: `onError(cb)` — a compiler-erased intrinsic imported from `@openelement/element` and called at the top level of a component body — is the error boundary of **one generated element**.

```tsx
import { onError, useHost } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'my-widget',
  root: 'shadow',
  hydrate: 'idle',
  ssr: true,
});

export default function MyWidget() {
  const host = useHost();

  onError((env) => {
    // `env.error` is the thrown value exactly as thrown, never wrapped. This
    // callback bounds THIS element: a failure inside a child element is not
    // reported here, because no ancestor boundary intercepts a descendant.
    host.setAttribute('data-failed', '1');
    void env.error;
  });

  return <p>widget</p>;
}
```

**State the boundary honestly: it is element-scoped.** The callback runs when a value escapes the element's own work — the connect/claim pass (mount, claim, setup and the `onConnect` replay), or an update-phase write (a tracked slot refresh, or a DOM event handler dispatched inside the compiled body). It is **not** a subtree boundary and it does **not** contain failures across elements: cross-element containment retired with the class base, and no wrapper component replaces it. There is no `ErrorBoundary` to extend and no protected `onError` hook to override — `ErrorBoundary` is not exported from `@openelement/element` at all, so a module still importing it does not evaluate.

A catching handler changes only whether the error escapes. A connect-phase failure still leaves the element in its defined post-failure state (no projection, no listeners), and a later reconnect retries from scratch; an update-phase failure leaves the previously written DOM in place with the subscription still live. With no registered handler, the throw surfaces unchanged. A handler that itself throws **replaces** the original error — that new throw is what surfaces.

The callback is **client-owned**: it is erased into the compiled module and never runs during a server render. A producer throw at SSR fails the render and reaches the route's error projector, exactly as before — so a server-rendered failure is never this callback's business.

## Build-time diagnostics

Everything above is the runtime channel. The compiler answers separately: a module outside the authoring grammar fails the build with a source-located diagnostic carrying a stable `OEC####` code — the attribute, Block, intrinsic and provenance rules the compiled component boundary enforces. [Error codes](/errors) lists every code with the message it raises and the exact source call sites, generated from the diagnostics themselves, so the table cannot describe a code the build no longer produces or omit one it does.

### The machine-readable envelope

Every build failure — compiler diagnostics, style-plan refusals, admission warnings, SSG failures — can answer on one machine-readable channel: a JSON envelope with `code`, `severity`, `phase`, `message`, and, when the producer has a source location, `file`, `line` (1-based), `column`; when the producer can name the fix, a `hint`. The envelope type is owned by `@openelement/protocol`; producers keep their own code registries (`OEC####`, `OE_PRESET_*`, `OE_SSG_*`), so a code is always the producer's own and an unknown code still round-trips.

`openelement build` emits the aggregate on request, alongside the unchanged human output and exit codes:

```sh
openelement build --diagnostics=json          # one JSON report line on stderr
openelement build --diagnostics-file=diagnostics.json   # the same document to a file
```

A build that produced no diagnostics writes nothing at all. The report is one document:

```json
{
  "format": "openelement.diagnostics/1",
  "ok": false,
  "diagnostics": [
    {
      "code": "OE_COMPILER_DIAGNOSTICS",
      "severity": "error",
      "phase": "build",
      "message": "Build failed with 1 error",
      "file": "app/components/broken-page.tsx"
    },
    {
      "code": "OEC9042",
      "severity": "error",
      "phase": "build",
      "message": "spread attributes are outside the admitted grammar",
      "file": "app/components/broken-page.tsx",
      "line": 8,
      "column": 11
    }
  ]
}
```

`format` is the contract tag: consumers branch on it instead of guessing, and a future shape change mints a new tag rather than reinterpreting old bytes. `ok` is false the moment any diagnostic carries severity `error`. A failing fixture build emits ONE aggregate containing every code the failure produced — the compiler's family classification and each authored `OEC####` record with its authored position — read as JSON by a consumer harness, never grepped from logs. Warnings the build recorded (the admission scan's report classes) ride the same aggregate; a warn-only build answers `ok: true`.

## See also

- [Routing and Data](/guide/routing-and-data) — where `fail()`, `redirect()` and actions are introduced.
- [Error codes](/errors) — the compiler diagnostics, code by code.
- [Security](/guide/security) — the status codes and headers the generated handlers send.
- [API Routes](/guide/api) — the same response primitives for non-page routes.
