/** @jsxImportSource @openelement/element */
import { element, OpenElement } from '@openelement/element';
// The fixture island hosts the interop probe components; importing it here
// keeps it reachable from the generated client delivery graph.
import '../islands/interop-fixture.tsx';

/** / page element (compiled) — static page hosting the interop-fixture island. */
@element('index-page', { root: 'shadow-open' })
export default class InteropHomePage extends OpenElement {
  render() {
    return <interop-fixture></interop-fixture>;
  }
}
