/**
 * request-time home page — static prerendered page (compiled, v0.44).
 * The route module (app/routes/index.tsx) attaches the page descriptor.
 */
import { element, OpenElement } from '@openelement/element';

@element('index-page', { root: 'shadow-open' })
export default class HomePage extends OpenElement {
  render() {
    return (
      <main>
        <h1 id='home-marker'>request-time fixture home</h1>
        <p>This page is prerendered; /live is rendered at request time.</p>
      </main>
    );
  }
}
