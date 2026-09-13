/**
 * /tabs page — qualifies open-tabs (WAI-ARIA tabs pattern) on the compiled
 * framework (#1226): light-DOM tab/panel decoration, roving tabindex,
 * ArrowLeft/ArrowRight/Home/End keyboard selection, and the #move-target
 * container used by the reconnect/dispose spec.
 */
import { element, OpenElement } from '@openelement/element';
import '@openelement/ui/open-tabs';

@element('tabs-page', { root: 'shadow-open' })
export default class TabsPage extends OpenElement {
  render() {
    return (
      <main>
        <h1>ui dogfood — tabs</h1>
        <open-tabs id='main-tabs'>
          <button slot='tab' type='button'>Alpha</button>
          <button slot='tab' type='button'>Beta</button>
          <button slot='tab' type='button'>Gamma</button>
          <div slot='panel'>Alpha panel content</div>
          <div slot='panel'>Beta panel content</div>
          <div slot='panel'>Gamma panel content</div>
        </open-tabs>
        <div id='tabs-move-target'></div>
      </main>
    );
  }
}
