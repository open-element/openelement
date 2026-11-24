/**
 * ui-dogfood home — static prerendered page (compiled, v0.44).
 *
 * GENERATED lane (2026-11-21 closeout: class → function). The page keeps the
 * class lane's `shadow` root: the e2e specs reach this page's content through
 * the shadow-walker helpers, which only pierce an open shadow root.
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ tag: 'index-page', root: 'shadow' });

export default function HomePage() {
  return (
    <main>
      <h1 id="home-marker">ui dogfood fixture home</h1>
      <nav>
        {/* One explicit space between the links: an inter-element space written
            as plain JSX whitespace on the same line is dropped by the function
            lane, and these are inline anchors, so the class lane's separation
            would visibly collapse. */}
        <a href="/dialog">dialog</a>{' '}
        <a href="/dropdown">dropdown</a>{' '}
        <a href="/form">form</a>{' '}
        <a href="/boundaries">boundaries</a>
      </nav>
    </main>
  );
}
