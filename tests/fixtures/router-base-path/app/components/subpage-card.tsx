/**
 * Non-root-base fixture — nested SHADOW component (S-C2/S-12). Its sheet is
 * delivered inside its own DSD template as a marked link (the shadow half of
 * the protocol), unscoped, with the configured base in the href.
 */
import { element, OpenElement } from '@openelement/element';
import cardStyles from './subpage-card.css';

@element('subpage-card', { root: 'shadow-open' })
export default class SubpageCard extends OpenElement {
  static override styles = [cardStyles];

  render() {
    return <span class='subpage-card'>carded</span>;
  }
}
