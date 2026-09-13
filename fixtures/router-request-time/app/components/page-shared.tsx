/**
 * /shared page element — the enhanced form lives in an IMPORTED module
 * (#577): the route module (app/routes/shared.tsx) contains no
 * data-open-enhance literal; the scanner follows the import to this module
 * to ship the enhancement layer. (v0.44: the imported module is the compiled
 * page element itself.)
 */
import { element, OpenElement } from '@openelement/element';

@element('shared-page', { root: 'shadow-open' })
export default class SharedPage extends OpenElement {
  render() {
    return (
      <main>
        <h1>shared component form</h1>
        <form method='post' action='/form' data-open-enhance>
          <button id='shared-submit' type='submit'>Shared submit</button>
        </form>
      </main>
    );
  }
}
