/**
 * /register page element — zod validation recipe (compiled, v0.44). The
 * route action validates with zod; the framework stays validation-agnostic.
 * The error Region carries the constant zod message as static branch text.
 */
import { element, OpenElement, property } from '@openelement/element';

@element('register-page', { root: 'shadow-open' })
export default class RegisterPage extends OpenElement {
  @property({ reflect: false, attribute: false })
  email = '';

  @property({ reflect: false, attribute: false })
  welcomeText = 'welcome=';

  @property({ reflect: false, attribute: false })
  hasError = 0;

  render() {
    return (
      <main>
        <h1>register with zod</h1>
        <form method='post' data-open-enhance>
          <input id='email' name='email' type='text' value={this.email} />
          <button id='register' type='submit'>Register</button>
        </form>
        {this.hasError > 0
          ? <p id='error'>a valid email is required</p>
          : <span data-error='none'></span>}
        <p id='welcome'>{this.welcomeText}</p>
      </main>
    );
  }
}
