/**
 * /regions page element — data-open-region / data-open-preserve morph
 * semantics (ADR-0121 §8), compiled v0.44. The `bannerText`/`message`/
 * `hasError` properties are projected from request + action data by the
 * route module's page descriptor.
 */
import { element, OpenElement, property } from '@openelement/element';

@element('regions-page', { root: 'shadow-open' })
export default class RegionsPage extends OpenElement {
  @property({ reflect: false, attribute: false })
  bannerText = 'echo=';

  @property({ reflect: false, attribute: false })
  message = '';

  @property({ reflect: false, attribute: false })
  hasError = 0;

  render() {
    return (
      <main>
        <div data-open-region='banner'>
          <p id='banner'>{this.bannerText}</p>
        </div>
        <section data-open-region='form-area'>
          <form method='post' data-open-enhance>
            <input
              id='message'
              name='message'
              type='text'
              value={this.message}
            />
            <button id='submit' type='submit'>Send</button>
            <button id='missing' type='submit' data-open-region-target='no-such-region'>
              Send to missing region
            </button>
          </form>
          {this.hasError > 0
            ? <p id='error'>message is required</p>
            : <span data-error='none'></span>}
          <div id='preserved' data-open-preserve>
            <details id='preserved-details'>
              <summary>keep me</summary>
              secret
            </details>
          </div>
        </section>
        <live-counter></live-counter>
      </main>
    );
  }
}
