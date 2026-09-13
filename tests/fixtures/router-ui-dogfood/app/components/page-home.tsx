/** ui-dogfood home — static prerendered page (compiled, v0.44). */
import { element, OpenElement } from '@openelement/element';

@element('index-page', { root: 'shadow-open' })
export default class HomePage extends OpenElement {
  render() {
    return (
      <main>
        <h1 id='home-marker'>ui dogfood fixture home</h1>
        <nav>
          <a href='/dialog'>dialog</a> <a href='/tabs'>tabs</a> <a href='/dropdown'>dropdown</a>
          {' '}
          <a href='/form'>form</a> <a href='/boundaries'>boundaries</a>
        </nav>
      </main>
    );
  }
}
