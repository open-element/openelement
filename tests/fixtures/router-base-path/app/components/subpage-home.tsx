/**
 * Non-root-base fixture — light-root page component (S-C2/S-12).
 *
 * Renders a nested LIGHT component (its own sheet must reach the ORIGINAL
 * document head) and a nested SHADOW component (its sheet must reach the DSD
 * template as a marked link). Every resource URL must carry the configured
 * base (`/sub/`).
 */
import { element, OpenElement } from '@openelement/element';
// Side-effect imports admit the nested component tags (the fixture pattern).
import './subpage-note.tsx';
import './subpage-card.tsx';
import pageStyles from './subpage-home.css';

@element('subpage-home', { root: 'light' })
export default class SubpageHome extends OpenElement {
  static override styles = [pageStyles];

  render() {
    return (
      <main class='subpage-shell'>
        <h1>base-path fixture</h1>
        <p class='subpage-document'>document text</p>
        <subpage-note></subpage-note>
        <subpage-card></subpage-card>
      </main>
    );
  }
}
