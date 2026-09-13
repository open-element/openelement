/** /reset-password page element (v0.44 compiled). */
import { element, OpenElement, property } from '@openelement/element';

@element('reset-password-page', { root: 'shadow-open' })
export default class ResetPasswordPage extends OpenElement {
  @property({ reflect: false, attribute: false })
  errorText = '';

  render() {
    return (
      <main>
        <h1>Reset password</h1>
        <p id='error'>{this.errorText}</p>
        <form method='post'>
          <label>
            New password <input type='password' name='password' minlength={8} required />
          </label>
          <button type='submit'>Set password</button>
        </form>
      </main>
    );
  }
}
