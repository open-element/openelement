/** /auth/callback — PKCE exchange route (thin wrapper around the compiled page + route logic). */
import { definePage } from '@openelement/app';
import AuthCallbackPage from '../../components/page-auth-callback.tsx';
import { callbackPageProps, createCallbackLoader } from '../../route-logic/auth-callback.ts';

export const loader = createCallbackLoader();

export default definePage(AuthCallbackPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'Authentication callback' },
  props: callbackPageProps,
});
