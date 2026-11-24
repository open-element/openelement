import { defineIslandConfig, definePage } from '@openelement/router';
// Side-effect imports admit the nested generated components (the fixture pattern).
import '../islands/subpage-note.tsx';
import '../islands/subpage-card.tsx';

/**
 * The base-path fixture's static page — a SERVER FUNCTION PAGE that DECLARES its
 * own sheet (F16).
 *
 * A generated page ROOT must be a shadow root: classification requires the
 * compiler-emitted DSD host producer, and a light root has none. This fixture's
 * page is deliberately LIGHT — its sheet is a DOCUMENT resource whose link must
 * reach the ORIGINAL head, including the head the request-time server flushes
 * before any deferred frame — so it uses the server function page form, whose
 * output IS document content.
 *
 * The sidecar is what carries that sheet: a route module's declaration is
 * registered as a page-module declaration (unscoped, because a page owns no host
 * element) and the route's document link list seeds it.
 */
export const openElement = defineIslandConfig({
  tag: 'subpage-home',
  root: 'light',
  styles: ['./subpage-home.css'],
});

export function SubpageHome() {
  return (
    <main class="subpage-shell">
      <h1>base-path fixture</h1>
      <p class="subpage-document">document text</p>
      <subpage-note></subpage-note>
      <subpage-card></subpage-card>
    </main>
  );
}

export default definePage(SubpageHome, {
  head: { title: 'base-path fixture' },
});
