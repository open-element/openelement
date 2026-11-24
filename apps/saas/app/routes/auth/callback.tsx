/** /auth/callback — PKCE exchange route (the loader does the exchange; the page renders the outcome). */
import { defineIslandConfig, definePage } from '@openelement/router';
import { callbackPageProps, createCallbackLoader } from '../../route-logic/auth-callback.ts';

export const loader = createCallbackLoader();

/**
 * The page component is declared IN THIS MODULE (execution-plan §19.9): the
 * server function page lane records `pageComponentName` only for an exported
 * component function the route module declares itself, so an imported class
 * could not be admitted. Was `app/components/page-auth-callback.tsx`.
 */
export const openElement = defineIslandConfig({
  tag: 'auth-callback',
  root: 'shadow',
  properties: {
    errorText: { default: '' },
  },
});

export function AuthCallbackPage(props: { errorText: string }) {
  return (
    <main>
      <h1>Authentication</h1>
      <p id='error'>{props.errorText}</p>
      <a href='/login'>Request a new sign-in link</a>
    </main>
  );
}

export default definePage(AuthCallbackPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'Authentication callback' },
  props: callbackPageProps,
});
