/**
 * Root route of the UnoCSS probe fixture — a GENERATED light function page
 * (2026-11-21 closeout: class → function lane).
 *
 * The page's class tokens live in DOCUMENT DOM, so they are the document
 * sheet's business: the compiler collects them as LIGHT candidates and the
 * UnoCSS adapter compiles them into the document sheet — the same channel a
 * consumer's own markup classes take. Its irreducible authored rules (the
 * `host-panel` box and the one descendant selector the utility set does not
 * reach) are DECLARED on the sidecar and delivered UNSCOPED, because a page owns
 * no host element: its markup IS the document content.
 */
import { defineIslandConfig, definePage } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'probe-unocss-page',
  root: 'light',
  styles: ['../components/probe-page.css'],
});

export function ProbeUnocssPage() {
  return (
    <main class="probe-page host-panel mx-auto max-w-[42rem] px-6 py-10 font-sans text-foreground">
      <h1 class="m-0 text-xl font-semibold tracking-tight">openElement × UnoCSS</h1>
      <p class="mt-3 text-sm leading-relaxed text-muted">
        The document sheet is compiled by the application&rsquo;s own UnoCSS configuration from
        this page&rsquo;s admitted class tokens and the declared token source.
      </p>
      <probe-unocss-card></probe-unocss-card>
    </main>
  );
}

export default definePage(ProbeUnocssPage, {
  head: {
    title: 'openElement × UnoCSS probe',
    description:
      'The UnoCSS engine probe: real engine, independent token source, shadow + document delivery.',
    canonical: 'https://fixture.example.test/',
  },
});
