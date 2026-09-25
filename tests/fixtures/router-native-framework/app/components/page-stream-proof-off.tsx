import { element, OpenElement, property } from '@openelement/element';

@element('stream-proof-off-page', { root: 'shadow-open' })
export default class StreamProofOffPage extends OpenElement {
  @property({ reflect: false, attribute: false })
  message = '';

  render() {
    return (
      <main>
        <h1>Stream proof</h1>
        <p id='delayed'>{this.message}</p>
        <form method='post' action='/stream-proof'>
          <button type='submit'>Submit</button>
        </form>
      </main>
    );
  }
}
