/**
 * /third-party-wc page element (v0.44 compiled) — static page hosting the
 * wc-fixture island. The path-derived tag is 'third-party-wc'; the
 * page class is the route element itself (no separate content element).
 *
 * GENERATED lane (F16: class → function). The class had no `@property`, so this
 * page declares no property rows and its function body is pure markup.
 * `root: 'shadow'` reproduces the class lane's `shadow-open`, and `styles`
 * replaces `static styles = [wcPageStyles]` with the same sheet on the same one
 * style channel: the qualifier reads the fixture island THROUGH this page's
 * shadow root (`pierce('third-party-wc').shadowRoot`), so a light root would
 * move #wc-fixture out of the tree every browser probe walks.
 */
import { defineIslandConfig } from '@openelement/router';
// A foreign component creates each of these compiled children inside its own
// shadow root (or appends it to its own light DOM) at runtime, so the page
// imports every capability explicitly to keep it reachable from the generated
// client delivery graph. They are the late-host corpus: none of them has a
// host in the SSR markup.
import '../islands/wc-open-child.tsx';
import '../islands/wc-open-fast.tsx';
import '../islands/wc-open-stencil.tsx';
import '../islands/wc-open-native.tsx';
import '../islands/wc-open-light.tsx';
import '../islands/wc-open-nested.tsx';
import '../islands/wc-open-closed.tsx';
import '../islands/wc-unused-late.tsx';

export const openElement = defineIslandConfig({
  tag: 'third-party-wc',
  root: 'shadow',
  styles: ['./wc-page.css'],
});

export default function ThirdPartyWcPage() {
  return (
    <main>
      <h1>Third-party Web Components interop</h1>
      <wc-fixture></wc-fixture>
    </main>
  );
}
