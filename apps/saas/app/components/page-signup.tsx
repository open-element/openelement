/**
 * /signup page element (v0.44 compiled). Request-time rendered; the props
 * projector lives in app/route-logic/signup.ts. The confirmation note is a
 * fully static conditional Region branch; the action error and the email echo
 * ride text/property Parts.
 */
import { element, OpenElement, property } from '@openelement/element';

@element('signup-page', { root: 'shadow-open' })
export default class SignupPage extends OpenElement {
  @property({ reflect: false, attribute: false })
  errorText = '';

  @property({ reflect: false, attribute: false })
  email = '';

  @property({ reflect: false, attribute: false })
  sent = 0;

  render() {
    return (
      <main>
        <h1>Sign up</h1>
        <p id='error'>{this.errorText}</p>
        <form method='post'>
          <label>
            Email <input type='email' name='email' value={this.email} required />
          </label>
          <label>
            Password <input type='password' name='password' minlength={8} required />
          </label>
          <input type='hidden' name='next' value='/notes' />
          <button type='submit'>Create account</button>
        </form>
        {this.sent > 0
          ? <p id='message'>Check your email to confirm the account.</p>
          : <span></span>}
        <a href='/login'>Sign in</a>
      </main>
    );
  }
}
