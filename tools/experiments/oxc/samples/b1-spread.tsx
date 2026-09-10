/**
 * v0.44.0-alpha.0 compiler v1 negative fixture (#1160).
 *
 * Spread attributes are outside the program grammar. The transform must fail
 * closed with a source-located diagnostic and must never fall back to the
 * legacy runtime path.
 */
import { element, OpenElement } from '@openelement/element';

@element('oe-proof-unsupported')
export class UnsupportedProgram extends OpenElement {
  render() {
    const props = { id: 'spread' };
    return <div {...props}>nope</div>;
  }
}
