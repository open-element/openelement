// deno-fmt-ignore-file
import { type element, OpenElement, property } from '@openelement/element';
@element('oe-type-only-element')
export class TypeOnly extends OpenElement {
  @property({ reflect: false }) x = 0;
  render() { return <div>{this.x}</div>; }
}
