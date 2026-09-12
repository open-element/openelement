/**
 * /login — email+password sign-in (reference starter, #983) plus optional
 * OAuth providers (#998). Thin wrapper: the compiled page element lives in
 * app/components/page-login.tsx, the loader/action logic in
 * app/route-logic/login.ts.
 */
import { definePage } from '@openelement/app';
import LoginPage from '../components/page-login.tsx';
import {
  createLoginAction,
  createLoginLoader,
  createOAuthAction,
  loginPageProps,
} from '../route-logic/login.ts';

export const loader = createLoginLoader();
export const action = createLoginAction();
export const actions = { oauth: createOAuthAction() };

export default definePage(LoginPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'Sign in — reference starter' },
  props: loginPageProps,
});
