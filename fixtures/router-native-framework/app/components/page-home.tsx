/**
 * / page element — static prerendered home (compiled). `buildCountText`
 * embeds the note count captured at BUILD time; the SSG separation e2e
 * asserts it never changes at runtime.
 */
import { element, OpenElement, property } from '@openelement/element';

@element('index-page', { root: 'shadow-open' })
export default class HomePage extends OpenElement {
  @property({ reflect: false, attribute: false })
  buildCountText = 'build-count=0';

  render() {
    return (
      <main>
        <h1 id='home-marker'>app-flow-native home</h1>
        <p id='build-count'>{this.buildCountText}</p>
        <p>This page is prerendered; /notes is rendered at request time.</p>
        <a id='notes-link' href='/notes'>Notes</a>
      </main>
    );
  }
}
