/**
 * /signup — request-time sign-up route. Thin wrapper: the compiled page
 * element lives in app/components/page-signup.tsx, the loader/action logic in
 * app/route-logic/signup.ts.
 */
import { definePage } from '@openelement/router';
import { defineIslandConfig } from '@openelement/router';
import { createSignupAction, signupLoader, signupPageProps } from '../route-logic/signup.ts';

/**
 * The page component is declared IN THIS MODULE (execution-plan §19.9): the
 * server function page lane records `pageComponentName` only for an exported
 * component function the route module declares itself, so an imported class
 * could not be admitted. Was `app/components/page-signup.tsx`.
 */

export const openElement = defineIslandConfig({
  tag: 'signup-page',
  root: 'shadow',
  properties: {
    errorText: { default: '' },
    email: { default: '' },
    sent: { default: 0 },
  },
});

export function SignupPage(props: { errorText: string; email: string; sent: number }) {
  return (
    <main>
      <h1>Sign up</h1>
      <p id='error'>{props.errorText}</p>
      <form method='post'>
        <label>
          Email <input type='email' name='email' value={props.email} required />
        </label>
        <label>
          Password <input type='password' name='password' minlength={8} required />
        </label>
        <input type='hidden' name='next' value='/notes' />
        <button type='submit'>Create account</button>
      </form>
      {props.sent > 0 ? (
        <p id='message'>Check your email to confirm the account.</p>
      ) : (
        <span></span>
      )}
      <a href='/login'>Sign in</a>
    </main>
  );
}

export const loader = signupLoader;
export const action = createSignupAction();

export default definePage(SignupPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'Sign up' },
  props: signupPageProps,
});
