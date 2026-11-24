/**
 * wc-unused-late — a declared island that this page NEVER hosts (C4).
 *
 * The negative control for the late-host probe. B2's page-scope promise is
 * that an island a page never reaches is never fetched; the probe adds a
 * bounded search for hosts, so the fixture must prove the search cannot turn
 * into a fetch. The browser probe asserts this chunk's URL is requested zero
 * times on the page.
 *
 * GENERATED lane (F16: class → function). `root: 'shadow'` reproduces the class
 * lane's `shadow-open`; the island is never fetched, so the value only has to
 * stay truthful for the descriptor the build emits and the probe never reads.
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  hydrate: 'load',
  ssr: false,
  dsd: false,
  root: 'shadow',
});

export default function WcUnusedLate() {
  return <span id='unused-late-ready'>never hosted on this page</span>;
}
