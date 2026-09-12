/**
 * /signup — request-time sign-up route. Thin wrapper: the compiled page
 * element lives in app/components/page-signup.tsx, the loader/action logic in
 * app/route-logic/signup.ts.
 */
import { definePage } from '@openelement/app';
import SignupPage from '../components/page-signup.tsx';
import { createSignupAction, signupLoader, signupPageProps } from '../route-logic/signup.ts';

export const loader = signupLoader;
export const action = createSignupAction();

export default definePage(SignupPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'Sign up' },
  props: signupPageProps,
});
