// Control experiment: the IDENTICAL component rendered from a prerendered
// static route and from an ordinary request-time dynamic route.
import { element, OpenElement } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';
import panelStyles from './probe-panel.css';

export const openElement = defineIslandConfig({ hydrate: 'load', ssr: true, dsd: true });

@element('probe-panel', { root: 'shadow-open' })
export default class ProbePanel extends OpenElement {
  static override styles = [panelStyles];

  render() {
    return (
      <section class='probe-panel-body'>
        <span id='probe-panel-marker'>probe panel marker</span>
      </section>
    );
  }
}
