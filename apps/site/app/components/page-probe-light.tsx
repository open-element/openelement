// Page component for the /probe-light e2e probe route (#1148 / ADR-0142).
// The class lives here — not in the route module — because a module carrying
// an @element class is compiled under the compiled-element grammar, which
// admits no other runtime top-level statements; the route module needs them
// for its definePage descriptor (Beta.2.2, #1327).
//
// `renderMode = 'light'` on the page itself: the probe island must sit in the
// document tree, not inside a page shadow root. Page elements are never
// registered on the client (only islands are), so a pre-upgrade click landing
// in a shadow-mode page would key its replay queue to the never-hydrating
// page host and be lost; in light DOM the queue keys to the island host
// itself (pre-hydration-click.ts). The app shell still wraps the route — the
// light page element is slotted into open-layout like any other page.

import { element, OpenElement } from '@openelement/element';

@element('probe-light', { root: 'light' })
export default class ProbeLightPage extends OpenElement {
  render() {
    return (
      <main class='probe-light-page'>
        <h1>Light-mode activation probe</h1>
        <open-light-probe class='probe-host'></open-light-probe>
      </main>
    );
  }
}
