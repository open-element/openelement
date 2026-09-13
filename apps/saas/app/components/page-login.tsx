/**
 * /login page element (v0.44 compiled). Request-time rendered; the props
 * projector lives in app/route-logic/login.ts. Provider buttons post to the
 * named `oauth` action (the clicked button carries the provider id); each
 * known provider is a fully static conditional Region branch, and the
 * placeholder keeps "no provider configured" an explicit page state that
 * Tier-2 evidence can assert on.
 */
import { element, OpenElement, property } from '@openelement/element';

@element('login-page', { root: 'shadow-open' })
export default class LoginPage extends OpenElement {
  @property({ reflect: false, attribute: false })
  errorText = '';

  @property({ reflect: false, attribute: false })
  email = '';

  @property({ reflect: false, attribute: false })
  oauthGoogle = 0;

  @property({ reflect: false, attribute: false })
  oauthGithub = 0;

  @property({ reflect: false, attribute: false })
  oauthNone = 0;

  render() {
    return (
      <main>
        <h1>Sign in</h1>
        <p id='error'>{this.errorText}</p>
        <form method='post'>
          <p>
            <label>
              Email <input type='email' name='email' value={this.email} required />
            </label>
          </p>
          <p>
            <label>
              Password <input type='password' name='password' required />
            </label>
          </p>
          <button type='submit'>Sign in</button>
        </form>
        <section id='oauth'>
          <form method='post' action='/login?/oauth'>
            {this.oauthGoogle > 0
              ? <button type='submit' name='provider' value='google'>Continue with Google</button>
              : <span></span>}
            {this.oauthGithub > 0
              ? <button type='submit' name='provider' value='github'>Continue with GitHub</button>
              : <span></span>}
          </form>
          {this.oauthNone > 0
            ? <p id='oauth-not-configured'>OAuth providers: not configured</p>
            : <span></span>}
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
}
