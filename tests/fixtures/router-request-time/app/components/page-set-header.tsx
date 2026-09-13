/**
 * /set-header page element — ADR-0129 response-header channel page
 * (compiled, v0.44). `doneText` echoes the ?done= marker; loader/action live
 * in the route module.
 */
import { element, OpenElement, property } from '@openelement/element';

@element('set-header', { root: 'shadow-open' })
export default class SetHeaderPage extends OpenElement {
  @property({ reflect: false, attribute: false })
  doneText = 'done=';

  render() {
    return (
      <main>
        <h1>set-header</h1>
        <p id='done'>{this.doneText}</p>
        <form method='post'>
          <button type='submit'>go</button>
        </form>
      </main>
    );
  }
}
