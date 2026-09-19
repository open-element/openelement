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
import { element, OpenElement, property } from '@openelement/element';

@element('contact-page')
export default class ContactPage extends OpenElement {
  @property({ reflect: false, attribute: false })
  error = '';

  @property({ reflect: false, attribute: false })
  echoed = '';

  render() {
    return (
      <main>
        <h1>contact</h1>
        <form method='post' data-open-enhance>
          <input name='message' type='text' />
          <button type='submit'>Send</button>
          <button type='submit' formaction='?/shout'>Shout</button>
        </form>
        {this.error ? <p role='alert'>{this.error}</p> : <span></span>}
        {this.echoed ? <p>echo={this.echoed}</p> : <span></span>}
      </main>
    );
  }
}
```

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
