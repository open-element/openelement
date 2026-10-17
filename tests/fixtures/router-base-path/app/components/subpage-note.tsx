/**
 * Non-root-base fixture — nested LIGHT component (S-C2/S-12). Its sheet is a
 * document resource: the page render reports it and the head declares it, so
 * the styled content needs no client JavaScript.
 */
import { element, OpenElement } from '@openelement/element';
import noteStyles from './subpage-note.css';

@element('subpage-note', { root: 'light' })
export default class SubpageNote extends OpenElement {
  static override styles = [noteStyles];

  render() {
    return <span class='subpage-note'>noted</span>;
  }
}
