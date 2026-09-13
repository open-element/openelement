/** /auth/callback page element (v0.44 compiled). The PKCE exchange runs in the loader; the page renders the outcome. */
import { element, OpenElement, property } from '@openelement/element';

@element('auth-callback', { root: 'shadow-open' })
export default class AuthCallbackPage extends OpenElement {
  @property({ reflect: false, attribute: false })
  errorText = '';

  render() {
    return (
      <main>
        <h1>Authentication</h1>
        <p id='error'>{this.errorText}</p>
        <a href='/login'>Request a new sign-in link</a>
      </main>
    );
  }
}
