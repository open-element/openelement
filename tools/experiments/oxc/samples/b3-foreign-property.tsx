// deno-fmt-ignore-file
import { element, OpenElement } from '@openelement/element';
import { property } from '@third-party/decorators';
@element('oe-foreign-property')
export class ForeignProperty extends OpenElement {
  @property({ reflect: false }) x = 0;
  render() { return <div>{this.x}</div>; }
}
