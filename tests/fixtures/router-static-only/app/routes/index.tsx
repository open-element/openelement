/**
 * static-only home route — the page component is declared IN THIS MODULE.
 *
 * Generated-element page lane (2026-11-21 closeout): the route module records
 * `pageComponentName` only for an exported function it declares itself, so the
 * page renders through the compiled function page lane instead of a registered
 * class element. A LIGHT root owns no element sheet, so no `styles` declaration
 * exists here — the fixture renders plain markup.
 */
import { definePage } from '@openelement/router';

export function HomePage() {
  return (
    <main>
      <h1 id='home-marker'>static-only fixture home</h1>
    </main>
  );
}

export default definePage(HomePage, {
  head: { title: 'static-only fixture — home' },
});
