import { element, OpenElement, property } from '@openelement/element';
import '../islands/probe-panel.tsx';

@element('panel-dynamic-page', { root: 'shadow-open' })
export default class PanelDynamicPage extends OpenElement {
  static override styles = [];

  @property({ reflect: false })
  idText = 'id=';

  render() {
    return (
      <main id='panel-dynamic-main'>
        <h1>panel dynamic host</h1>
        <p id='panel-dynamic-id'>{this.idText}</p>
        <probe-panel></probe-panel>
      </main>
    );
  }
}
