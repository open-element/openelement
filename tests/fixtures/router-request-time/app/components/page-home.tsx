/**
 * request-time home page — static prerendered page (compiled, v0.44).
 * The route module (app/routes/index.tsx) attaches the page descriptor.
 *
 * GENERATED lane (F16: class → function). The page keeps its `shadow` root: the
 * e2e reads `#home-marker` after navigation, and a class-lane page was
 * shadow-open, so a light root here would move the marker out of the tree the
 * existing helper walks.
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ tag: 'index-page', root: 'shadow' });

export default function HomePage() {
  return (
    <main>
      <h1 id='home-marker'>request-time fixture home</h1>
      <p>This page is prerendered; /live is rendered at request time.</p>
    </main>
  );
}
