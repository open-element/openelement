/** @jsxImportSource @openelement/element */
import { defineIslandConfig } from '@openelement/router';
import { element, OpenElement } from '@openelement/element';

export const openElement = defineIslandConfig({
  hydrate: 'load',
  ssr: true,
  dsd: true,
});

/**
 * interop-fixture — canonical Web Components contract corpus island.
 *
 * Compiled island hosting the owned probe components (native, Lit, FAST,
 * Stencil). The probe definitions live in ../client/interop-client.ts and
 * register when the island activates; the browser qualification asserts the
 * native Custom Element contract against the upgraded DOM.
 */
@element('interop-fixture', { root: 'shadow-open' })
export default class InteropFixture extends OpenElement {
  onDsdHydrated(): void {
    this.loadInteropClient();
  }

  onCsrRendered(): void {
    this.loadInteropClient();
  }

  /** The module registers the probe definitions once (ESM evaluation cache). */
  loadInteropClient(): void {
    if (typeof window !== 'undefined') {
      void import('../client/interop-client.ts');
    }
  }

  render() {
    return (
      <main id='interop-main'>
        <h1>OpenElement Web Components interoperability corpus</h1>
        <interop-child-host id='children'>
          <interop-native-probe id='native-child' value='native-child'>
            Native child
          </interop-native-probe>
          <interop-lit-probe id='lit-child' value='lit-child'>
            Lit child
          </interop-lit-probe>
          <interop-fast-probe id='fast-child' value='fast-child'>
            FAST child
          </interop-fast-probe>
          <interop-stencil-probe id='stencil-child' disabled='true'>
            Stencil child
          </interop-stencil-probe>
        </interop-child-host>
        <section id='application-dependencies'>
          <h2>Application dependencies</h2>
          <interop-native-probe
            id='native-dependency'
            value='native-dependency'
          >
            Native dependency
          </interop-native-probe>
          <interop-lit-probe id='lit-dependency' value='lit-dependency'>
            Lit dependency
          </interop-lit-probe>
          <interop-fast-probe id='fast-dependency' value='fast-dependency'>
            FAST dependency
          </interop-fast-probe>
          <interop-stencil-probe id='stencil-dependency' disabled='true'>
            Stencil dependency
          </interop-stencil-probe>
        </section>
        <section id='fresh-probes' aria-hidden='true'></section>
      </main>
    );
  }
}
