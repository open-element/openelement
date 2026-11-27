/** The compiler admits page functions declared in their route module. */
import { definePage } from '@openelement/router';
import {
  createLoginAction,
  createLoginLoader,
  createOAuthAction,
  loginPageProps,
} from '../route-logic/login.ts';

export const loader = createLoginLoader();
export const action = createLoginAction();
export const actions = { oauth: createOAuthAction() };

/**
 * The page component. The props parameter is the projector's own row set
 * (`loginPageProps`): the error mount point, the submitted email echo and the
 * three OAuth branch flags. It must stay an INLINE object type literal — the
 * server function grammar refuses a type alias or interface (OEC9032).
 */
export function LoginPage(props: {
  errorText: string;
  email: string;
  oauthGoogle: number;
  oauthGithub: number;
  oauthNone: number;
}) {
  return (
    <main>
      <h1>Sign in</h1>
      <p id='error'>{props.errorText}</p>
      <form method='post'>
        <p>
          <label>
            Email{' '}
            <input
              type='email'
              name='email'
              autocomplete='username'
              spellcheck='false'
              value={props.email}
              required
            />
          </label>
        </p>
        <p>
          <label>
            Password{' '}
            <input type='password' name='password' autocomplete='current-password' required />
          </label>
        </p>
        <button type='submit'>Sign in</button>
      </form>
      <section id='oauth'>
        <form method='post' action='/login?/oauth'>
          {props.oauthGoogle > 0 ? (
            <button type='submit' name='provider' value='google'>
              {'Continue with Google'}
            </button>
          ) : (
            <span></span>
          )}
          {props.oauthGithub > 0 ? (
            <button type='submit' name='provider' value='github'>
              {'Continue with GitHub'}
            </button>
          ) : (
            <span></span>
          )}
        </form>
        {props.oauthNone > 0 ? (
          <p id='oauth-not-configured'>OAuth providers: not configured</p>
        ) : (
          <span></span>
        )}
      </section>
      <p>
        <a href='/signup'>Create account</a> · <a href='/magic-link'>Use a Magic Link</a> ·{' '}
        <a href='/recover'>Forgot password?</a>
      </p>
      <p>
        <a href='/notes'>Back to notes</a>
      </p>
    </main>
  );
}

export default definePage(LoginPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'Sign in — reference starter' },
  props: loginPageProps,
});
