/**
 * /magic-link — request-time magic-link route. Thin wrapper: the compiled
 * page element lives in app/components/page-magic-link.tsx, the
 * loader/action logic in app/route-logic/magic-link.ts.
 */
import { definePage } from '@openelement/router';
import { defineIslandConfig } from '@openelement/router';
import {
  createMagicLinkAction,
  magicLinkLoader,
  magicLinkPageProps,
} from '../route-logic/magic-link.ts';

/**
 * The page component is declared IN THIS MODULE (execution-plan §19.9): the
 * server function page lane records `pageComponentName` only for an exported
 * component function the route module declares itself, so an imported class
 * could not be admitted. Was `app/components/page-magic-link.tsx`.
 */

export const openElement = defineIslandConfig({
  tag: 'magic-link-page',
  root: 'shadow',
  properties: {
    errorText: { default: '' },
    email: { default: '' },
    sent: { default: 0 },
  },
});

function MagicLinkPage(props: { errorText: string; email: string; sent: number }) {
  return (
    <main>
      <h1>Magic Link</h1>
      <p id='error'>{props.errorText}</p>
      <form method='post'>
        <label>
          Email <input type='email' name='email' value={props.email} required />
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
