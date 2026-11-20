import { defineIslandConfig, definePage } from '@openelement/router';

/**
 * The base-path fixture's static page — a generated LIGHT function page that
 * DECLARES its own sheet (P-2b, 2026-11-21).
 *
 * A generated light page owns its root box rule the same way a class page's
 * `:host` does. Its declared sheet is a DOCUMENT resource, so it must reach the
 * ORIGINAL head — including the head the request-time server flushes before any
 * deferred frame resolves. The sidecar is the declaration; the route's document
 * link list is the delivery.
 */
import '../components/subpage-note.tsx';
import '../components/subpage-card.tsx';

export const openElement = defineIslandConfig({
  tag: 'subpage-home',
  root: 'light',
  styles: ['../components/subpage-home.css'],
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
