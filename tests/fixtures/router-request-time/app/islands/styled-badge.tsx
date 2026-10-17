// Nested Light component of the /styled/:id route: server-rendered, NEVER
// hydrated (`hydrate: 'none'`), so its stylesheet is delivered without shipping
// client JavaScript for it — while still using the framework's island
// admission, which is what makes a nested custom element renderable at all.
import { element, OpenElement } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';
import badgeStyles from './styled-badge.css';

export const openElement = defineIslandConfig({ hydrate: 'none', ssr: true });

@element('styled-badge', { root: 'light' })
export default class StyledBadge extends OpenElement {
  static override styles = [badgeStyles];

  render() {
    return (
      <div class='styled-badge'>
        <span class='styled-shared'>badge</span>
      </div>
    );
  }
}
