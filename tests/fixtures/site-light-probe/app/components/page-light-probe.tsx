// Page component for the light-mode probe fixture (#1148 / ADR-0142).
// The class lives here — not in the route module — because a module carrying
// an @element class is compiled under the compiled-element grammar, which
// admits no other runtime top-level statements; the route module needs them
// for its definePage descriptor.
//
// `root: 'light'` on the page: the probe island must sit in the document
// tree, not inside a page shadow root. Page elements are never registered on
// the client (only islands are), so a pre-upgrade click landing in a
// shadow-mode page would key its replay queue to the never-hydrating page
// host and be lost; in light DOM the queue keys to the island host itself.
// The fixture has no app shell, so the page renders directly into <body>.

import { element, OpenElement } from '@openelement/element';

@element('light-probe-page', { root: 'light' })
export default class LightProbePage extends OpenElement {
  render() {
    return (
      <main class='light-probe-page'>
        <h1>Light-mode activation probe</h1>
        <open-light-probe class='probe-host'></open-light-probe>
        <light-probe-runtime-carrier hidden></light-probe-runtime-carrier>
      </main>
    );
  }
}
