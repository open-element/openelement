/** @jsxImportSource @openelement/element */
import { element, OpenElement } from '@openelement/element';
// The fixture islands host the interop probe components; importing them here
// keeps them reachable from the generated client delivery graph.
import '../islands/interop-fixture.tsx';
import '../islands/interop-generated-host.tsx';

/** / page element (compiled) — static page hosting the interop fixture islands. */
@element('index-page', { root: 'shadow-open' })
export default class InteropHomePage extends OpenElement {
  render() {
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
      </div>
    );
  }
}
