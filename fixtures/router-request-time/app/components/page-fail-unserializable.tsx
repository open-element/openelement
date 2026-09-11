/**
 * /fail-unserializable page element — static markup; the fail()-payload
 * protocol cases live in the route module's action (#1146 area 4).
 */
import { element, OpenElement } from '@openelement/element';

@element('fail-unserializable', { root: 'shadow-open' })
export default class FailUnserializablePage extends OpenElement {
  render() {
    return (
      <main>
        <h1>fail-unserializable</h1>
        <form method='post'>
          <button type='submit'>go</button>
        </form>
      </main>
    );
  }
}
