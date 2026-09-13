/**
 * /recover page element (v0.44 compiled). Request-time rendered; the route
 * module's props projector (route-logic/recover.ts) maps loader/action state
 * onto the compiled properties. The sent confirmation is a fully static
 * conditional Region branch; the action error rides the text Part.
 */
import { element, OpenElement, property } from '@openelement/element';

@element('recover-page', { root: 'shadow-open' })
export default class RecoverPage extends OpenElement {
  @property({ reflect: false, attribute: false })
  errorText = '';

  @property({ reflect: false, attribute: false })
  sent = 0;

  render() {
    return (
      <main>
        <h1>Recover password</h1>
        <p id='error'>{this.errorText}</p>
        {this.sent > 0
          ? <p id='message'>If the account exists, a recovery email has been sent.</p>
          : <span></span>}
        <form method='post'>
          <label>
            Email <input type='email' name='email' required />
          </label>
          <button type='submit'>Send recovery email</button>
        </form>
      </main>
    );
  }
}
