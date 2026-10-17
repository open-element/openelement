// Server-only Light page of the /styled/:id route (S-C1.4, #1609): nothing but
// its route imports it, so every sheet below must be discovered from the
// SERVER-rendered module graph. The nested badge is reached through the
// package.json `imports` alias `#app/*`.
import { element, OpenElement, property } from '@openelement/element';
import '#app/islands/styled-badge.tsx';
import pageStyles from './page-styled.css';

@element('styled-page', { root: 'light' })
export default class StyledPage extends OpenElement {
  static override styles = [pageStyles];

  @property({ reflect: false })
  idText = 'id=';

  render() {
    return (
      <main id='styled-page-main' class='styled-page'>
        <h1>styled page host</h1>
        <p id='styled-page-id' class='styled-shared'>{this.idText}</p>
        <styled-badge></styled-badge>
      </main>
    );
  }
}
