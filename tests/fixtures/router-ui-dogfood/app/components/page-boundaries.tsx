/**
 * /boundaries page — qualifies the open/light/closed root contracts side by side
 * (#1226): @openelement/ui primitives are shadow-open (observable shadowRoot),
 * while the consumer-authored dogfood-light and dogfood-closed elements prove the
 * other two root modes through the same compiled path. The ui primitive here is
 * open-button (#1557 retired open-badge to a CSS recipe; the boundary evidence
 * keeps a retained interactive component).
 *
 * GENERATED lane (F16: class → function). The page keeps its `shadow` root so the
 * spec's shadow-walker helper still pierces it, and the closed component keeps
 * `root: 'closed'` so the encapsulated contract is proven rather than described.
 */
import '@openelement/ui/open-button';
import { defineIslandConfig } from '@openelement/router';
import './boundary-closed.tsx';
import './boundary-light.tsx';

export const openElement = defineIslandConfig({ tag: 'boundaries-page', root: 'shadow' });

export default function BoundariesPage() {
  return (
    <main>
      <h1>ui dogfood — boundaries</h1>
      <open-button id="open-boundary" variant="primary">
        open shadow boundary
      </open-button>
      <dogfood-light></dogfood-light>
      <dogfood-closed></dogfood-closed>
    </main>
  );
}
