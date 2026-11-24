/**
 * /shared page element — the enhanced form lives in an IMPORTED module
 * (#577): the route module (app/routes/shared.tsx) contains no
 * data-open-enhance literal; the scanner follows the import to this module
 * to ship the enhancement layer. (v0.44: the imported module is the compiled
 * page element itself.)
 *
 * GENERATED lane (F16: class → function). The `data-open-enhance` literal must
 * stay in this module rather than move to the route: it is the fact whose
 * discovery through an IMPORT the #577 row asserts.
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ tag: 'shared-page', root: 'shadow' });

export default function SharedPage() {
  return (
    <main>
      <h1>shared component form</h1>
      <form method='post' action='/form' data-open-enhance>
        <button id='shared-submit' type='submit'>Shared submit</button>
      </form>
    </main>
  );
}
