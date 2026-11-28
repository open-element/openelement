import { definePage } from '@openelement/router';
import { defineIslandConfig } from '@openelement/router';
import {
  createMagicLinkAction,
  magicLinkLoader,
  magicLinkPageProps,
} from '../route-logic/magic-link.ts';

// The compiler admits page functions declared in their route module.
export const openElement = defineIslandConfig({
  tag: 'magic-link-page',
  root: 'shadow',
  properties: {
    errorText: { default: '' },
    email: { default: '' },
    sent: { default: 0 },
  },
});

export function MagicLinkPage(props: { errorText: string; email: string; sent: number }) {
  return (
    <main>
      <h1>Magic Link</h1>
      <p id='error'>{props.errorText}</p>
      <form method='post'>
        <label>
          Email{' '}
          <input
            type='email'
            name='email'
            autocomplete='email'
            spellcheck='false'
            value={props.email}
            required
          />
        </label>
        <button type='submit'>Send link</button>
      </form>
      {props.sent > 0 ? <p id='message'>Check your email for a sign-in link.</p> : <span></span>}
    </main>
  );
}

export const loader = magicLinkLoader;
export const action = createMagicLinkAction();

export default definePage(MagicLinkPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'Magic Link' },
  props: magicLinkPageProps,
});
