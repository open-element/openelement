/**
 * /subscribe page element — valibot validation recipe (compiled, v0.44):
 * same contract as the zod recipe, different library, to prove the loop is
 * library-agnostic.
 */
import { element, OpenElement, property } from '@openelement/element';

@element('subscribe-page', { root: 'shadow-open' })
export default class SubscribePage extends OpenElement {
  @property({ reflect: false, attribute: false })
  email = '';

  @property({ reflect: false, attribute: false })
  welcomeText = 'welcome=';

  @property({ reflect: false, attribute: false })
  hasError = 0;

  render() {
    return (
      <main>
        <h1>subscribe with valibot</h1>
        <form method='post' data-open-enhance>
          <input id='email' name='email' type='text' value={this.email} />
          <button id='subscribe' type='submit'>Subscribe</button>
        </form>
        {this.hasError > 0
          ? <p id='error'>a valid email is required</p>
          : <span data-error='none'></span>}
        <p id='welcome'>{this.welcomeText}</p>
      </main>
    );
  }
}
