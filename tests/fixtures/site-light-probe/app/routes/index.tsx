// Root route for the light-mode probe fixture (#1148 / ADR-0142).
//
// The page COMPONENT lives here (F16), as a SERVER FUNCTION PAGE that declares its
// own sheet. It cannot be a generated page ROOT: `root: 'light'` is the whole point
// of this fixture — the probe island must sit in the document tree, not inside a
// page shadow root — and a generated page root is required to be a shadow root
// (classification needs the compiler-emitted DSD host producer, which a light root
// has none of). A server function page's output IS document content, which is
// exactly what this fixture measures.
//
// Why the light root matters: page elements are never registered on the client
// (only islands are), so a pre-upgrade click landing in a shadow-mode page would
// key its replay queue to the never-hydrating page host and be lost; in light DOM
// the queue keys to the island host itself. The fixture has no layout, so the page
// renders directly into <body>.
//
// The page is the OUTER light root of the style probe (alpha15 S lane, S-C1.2): its
// own authored sheet is one of the document's stylesheet links, and the component
// types nested inside it are more.

import { defineIslandConfig, definePage } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'light-probe-page',
  root: 'light',
  styles: ['../components/page-light-probe.css'],
});

export function LightProbePage() {
  return (
    <main class="light-probe-page">
      <h1>Light-mode activation probe</h1>
      {/* The unrelated document element with the overlapping class name: it must
          keep the document's own color, never a component's. */}
      <p class="probe-shared document-probe">document text</p>
      <open-light-probe class="probe-host"></open-light-probe>
      {/* Two instances of ONE component type: one emitted stylesheet, two hosts. */}
      <light-probe-card count="1"></light-probe-card>
      <light-probe-card count="2"></light-probe-card>
      {/* The shadow-root half of the resource probe: its sheet reaches the shadow
          root as an adopted CSSStyleSheet parsed from the emitted asset, so the
          asset's `@import` and `url()` resolution is what the shadow tree styles
          depend on. */}
      <probe-shadow-card></probe-shadow-card>
      {/* The CSS-semantics probe (S-C2/S-11): its sheet carries nesting, a keyframe
          animation, a registered @property and a ::slotted rule. The slotted child
          below is light DOM the shadow sheet may only reach through
          `::slotted()`, and `p.nested-target` is the light-DOM twin of the shadow
          sheet's nested selector — it must NOT match. */}
      <semantics-probe>
        <span slot="label" class="probe-slot">slotted label</span>
      </semantics-probe>
      <p class="nested-target">light twin</p>
      {/* Document-scope `@property` registration probes (S-C2/S-11): this sheet is
          a document link, so the registration must be effective. */}
      <span class="doc-ratio-default">doc ratio default</span>
      <span class="doc-ratio-invalid">doc ratio invalid</span>
      {/* The generated light-root island: a plain tag with no SSR producer, styled
          only by its document-head sheet (Alpha16 retained stylesheet delivery).
          Its host box is observable without JS; its content is client-mounted. */}
      <gen-light-probe></gen-light-probe>
      <light-probe-runtime-carrier hidden></light-probe-runtime-carrier>
    </main>
  );
}

export default definePage(LightProbePage, {
  head: {
    title: 'Light-mode activation probe',
    description: 'Internal end-to-end probe for the compiled light-root rendering path.',
    canonical: 'https://fixture.example.test/',
  },
});
