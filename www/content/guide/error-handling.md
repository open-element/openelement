---
title: 'Error Handling'
lede: 'Error handling preserves platform semantics and keeps route failures visible.'
order: 80
---

## fail(): the return channel

Expected action failures return, never throw: `fail(status, data)` requires a 4xx status and produces an `OpenElementActionFailure`. The server answers with the `fail()` status (conventionally 422), the page re-rendered and the submitted values echoed; the page descriptor's `props` projector reads the failure from its context's `actionData` and maps it onto the compiled page properties. `isActionFailure()` is the duck-typed guard (ADR-0120). Enhanced forms morph only 200/422 responses (#973): a non-422 4xx fails over to a full navigation — the failure echo is lost on that path, so keep validation failures at 422.

## redirect() and notFound()

Control flow throws: `redirect(location, status)` throws `OpenElementRedirect` — the status is restricted to 301/302/303/307/308, and every 3xx is coerced to 303 in the POST action context (PRG); `notFound(message)` throws `OpenElementNotFound` (404). `isOpenElementRedirect()` and `isOpenElementNotFound()` match by shape, so the guards survive serialization boundaries.

## The error projector

`definePage(PageClass, { error })` declares the page-level error projector: it receives the caught `error` plus the render context and returns the error variant of the page's compiled properties (the generated entry re-renders the page with those props and status 500 — the ADR-0121 §7 channel); without it the generic status page answers. `notFound()` and unexpected loader/action throws land here; on the SPA chain a throw is normalized into the same channel instead of silently replacing loader data. On the programmatic action channel (`x-openelement-action: true`), error outcomes answer RFC 9457 Problem Details (`application/problem+json` with `type`/`title`/`status`/`detail`) instead of a bespoke JSON envelope (#863, ADR-0123); ADR-0122 freezes this wire shape.

### app/components/page-post.tsx

```tsx
// Compiled by the open:compiled-element transform.
import { element, OpenElement, property } from '@openelement/element';

@element('post-page', { root: 'shadow-open' })
export default class PostPage extends OpenElement {
  @property({ reflect: false, attribute: false })
  title = '';

  @property({ reflect: false, attribute: false })
  error = '';

  @property({ reflect: false, attribute: false })
  status = 0;

  render() {
    return (
      <main>
        {this.status
          ? <h1>{this.status}</h1>
          : (
            <form method='post' data-open-enhance>
              <input name='title' value={this.title} />
              <button type='submit'>Save</button>
              {this.error ? <p role='alert'>{this.error}</p> : <span></span>}
            </form>
          )}
      </main>
    );
  }
}
```

### app/routes/posts/[id].tsx

```ts
import {
  definePage,
  fail,
  isOpenElementNotFound,
  notFound,
  type OpenElementActionFailure,
  redirect,
} from '@openelement/app';
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
  props({ actionData }) {
    const action = actionData as PostActionData | undefined;
    return { title: action?.title ?? '', error: action?.error ?? '' };
  },
  error(error) {
    // notFound() and unexpected throws land on the error projector.
    return { status: isOpenElementNotFound(error) ? 404 : 500 };
  },
});
```

`redirect()` also takes an explicit status (301/302/303/307/308); any other status is rejected at call time. The same guards work on the SPA chain, but SPA loaders/actions receive only `{ params }` (plus `formData` for actions).
