---
title: 'Form actions end to end'
lede: 'A contact form that validates, echoes failures and redirects on success — no client JavaScript required.'
navLabel: 'Form actions'
order: 120
section: 'Recipes'
---

## The loop

One route, one form, three outcomes: empty submissions re-render with the echo at 422, valid submissions answer 303 to the PRG target, and a named action offers a second verb on the same form. This is the application loop from [Routing and Data](/guide/routing-and-data), reduced to the smallest runnable shape.

## The component

```tsx
// app/components/page-contact.tsx — the form's own markup, no client behavior.
import { computed } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'contact-page',
  // The page root is a shadow root: the compiler's DSD host producer renders it,
  // which is what puts the form in the first response with no script.
  root: 'shadow',
  properties: {
    // One row per projector key. Both values are attribute-free: the projector
    // is their only channel, so nothing can leak into a host attribute.
    error: { attribute: false, default: '' },
    echoed: { attribute: false, default: '' },
  },
});

export default function ContactPage(props: { error: string; echoed: string }) {
  // Derived, not stored: the flags are projections of the rows, so they can
  // never disagree with the values they gate.
  const hideError = computed(() => props.error === '');
  const hideEcho = computed(() => props.echoed === '');

  return (
    <main>
      <h1>contact</h1>
      <form method='post' data-open-enhance>
        <input name='message' type='text' />
        <button type='submit'>Send</button>
        <button type='submit' formaction='?/shout'>Shout</button>
      </form>
      <p role='alert' hidden={hideError.value}>{props.error}</p>
      <p hidden={hideEcho.value}>echo=<span>{props.echoed}</span></p>
    </main>
  );
}
```

The two message elements sit outside any conditional on purpose. A branch admits a JSX element or `null`, and a branch whose *value* is text — `{props.error ? 'has an error' : null}` — fails closed with `OEC9042` ("a conditional branch must be JSX or null"). The recipe keeps both messages unconditionally rendered and derives a boolean `computed()` per row, toggling the `hidden` attribute instead. The echoed value therefore stays an ordinary text interpolation: it has one stable node, and it is never the thing a branch has to re-create.

## The route

```ts
import { definePage, fail, redirect } from '@openelement/router';
import ContactPage from '../components/page-contact.tsx';

export function action(ctx: { formData: FormData }) {
  const message = String(ctx.formData.get('message') ?? '').trim();
  if (!message) {
    return fail(422, { error: 'message is required' });
  }
  throw redirect('/contact?echoed=' + encodeURIComponent(message));
}

export const actions = {
  shout(ctx: { formData: FormData }): never {
    const message = String(ctx.formData.get('message') ?? '').trim() || 'silence';
    throw redirect('/contact?echoed=' + encodeURIComponent(message.toUpperCase()));
  },
};

export default definePage(ContactPage, {
  renderIntent: { mode: 'dynamic' },
  props({ actionData, request }) {
    const data = actionData as { error?: string } | undefined;
    const echoed = request ? new URL(request.url).searchParams.get('echoed') : undefined;
    return { error: data?.error ?? '', echoed: echoed ?? '' };
  },
});
```

## Why it works without JavaScript

The form is plain HTML: the browser POSTs, the action answers 422 or 303, and the route re-renders. `data-open-enhance` only upgrades the experience (fetch + in-place morph) where islands are hydrated. An action must stay safe to re-run after a failed validation — that constraint is what makes the no-JS path and the enhanced path the same code.

## See also

- [Routing and Data](/guide/routing-and-data) — loaders, the full guestbook and the frozen loop semantics.
- [Glossary](/guide/glossary) — action, PRG, `trustedHtml` in one place.
