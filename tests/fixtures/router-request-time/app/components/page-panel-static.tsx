import { element, OpenElement } from '@openelement/element';
import '../islands/probe-panel.tsx';

@element('panel-static-page', { root: 'shadow-open' })
export default class PanelStaticPage extends OpenElement {
  render() {
    return (
      <main id='panel-static-main'>
        <h1>panel static host</h1>
        <probe-panel></probe-panel>
      </main>
    );
  }
}
