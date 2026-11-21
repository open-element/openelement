/** @jsxImportSource @openelement/element */
import { defineIslandConfig } from '@openelement/router';
// The fixture islands host the interop probe components; importing them here
// keeps them reachable from the generated client delivery graph.
import '../islands/interop-fixture.tsx';
import '../islands/interop-generated-host.tsx';
// M11 complete vertical: the real ssr:true generated shadow host island. Its
// DSD is produced by the canonical generated host producer through the
// generated entry's static host import + single-owner registration pairing.
import '../islands/interop-generated-ssr-card.tsx';

/**
 * / page element (compiled) — static page hosting the interop fixture islands.
 *
 * GENERATED lane (F16: class → function). No root option is omitted here: the
 * class declared `shadow-open`, and the qualification probes read the fixture
 * THROUGH this page's shadow root (`page.querySelector('index-page').shadowRoot`
 * then `interop-fixture`), so `root: 'shadow'` keeps every probe target in the
 * tree they are read from. The page declares no property rows because the class
 * had none; the `render()` body is unchanged markup.
 */
export const openElement = defineIslandConfig({
  tag: 'index-page',
  root: 'shadow',
});

export default function InteropHomePage() {
  return (
    <div id='interop-page'>
      <interop-fixture></interop-fixture>
      {/*
        M09-3 generated-host block: the real generated Native CE (function
        island compiled by the M09-1 lane) is the host; the four canonical
        foreign probe tags are its light children and the authored caption is
        its named slot content. The host renders no DSD (M11 wiring), so SSR
        ships this as a plain tag plus the authored light children.
      */}
      <interop-generated-host id='generated-host'>
        <span id='generated-light-caption' slot='caption'>
          generated host caption
        </span>
        <interop-native-probe id='generated-native' value='native-child'>
          Native child
        </interop-native-probe>
        <interop-lit-probe id='generated-lit' value='lit-child'>
          Lit child
        </interop-lit-probe>
        <interop-fast-probe id='generated-fast' value='fast-child'>
          FAST child
        </interop-fast-probe>
        <interop-stencil-probe id='generated-stencil' disabled='true'>
          Stencil child
        </interop-stencil-probe>
      </interop-generated-host>
      {/*
        M11 complete vertical: the real ssr:true generated shadow host. The
        attributes are LITERAL/STATIC (the standard SSR semantics the host
        producer seeds through the canonical attribute conversion), and the
        span is the page's light child, projected by the host's own named
        slot after the DSD template.
      */}
      <interop-generated-ssr-card
        id='generated-ssr-host'
        title='a "b" <c>'
        note='<script>alert(1)</script>'
      >
        <span slot='x'>light & child</span>
      </interop-generated-ssr-card>
    </div>
  );
}
