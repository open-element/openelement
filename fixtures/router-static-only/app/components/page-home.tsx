/**
 * static-only home page — canonical compiled page element (v0.44, ADR-0143).
 *
 * The route module (app/routes/index.tsx) default-exports this class wrapped
 * in definePage(); the compiled Part Program is the render — there is no
 * runtime JSX path. The compile-time-only element binding is a canonical
 * named import (the open:compiled-element transform strips it from the
 * generated module); see __fixtures__/compiled-element-v1/counter.tsx.
 */
import { element, OpenElement } from '@openelement/element';

@element('index-page', { root: 'shadow-open' })
export default class HomePage extends OpenElement {
  render() {
    return (
      <main>
        <h1 id='home-marker'>static-only fixture home</h1>
      </main>
    );
  }
}
