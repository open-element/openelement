/** @jsxImportSource @openelement/element */
import { onConnect } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';

/**
 * interop-fixture — canonical Web Components contract corpus island.
 *
 * Compiled island hosting the owned probe components (native, Lit, FAST,
 * Stencil). The probe definitions live in ../client/interop-client.ts and
 * register when the island activates; the browser qualification asserts the
 * native Custom Element contract against the upgraded DOM.
 *
 * GENERATED lane (F16: class → function). `root: 'shadow'` reproduces the class
 * lane's `shadow-open` — the probes are read from this island's OWN shadow root,
 * so a light root would move every one of them into the page tree.
 */
export const openElement = defineIslandConfig({
  hydrate: 'load',
  ssr: true,
  dsd: true,
  root: 'shadow',
});

export default function InteropFixture() {
  // The class lane split this one event across two hooks (onDsdHydrated for the
  // claim path, onCsrRendered for the fresh-creation path); onConnect replays
  // after either, which is the same moment with one spelling. The import itself
  // is the registration: the module defines the probes on evaluation and ESM's
  // module cache makes a second connection a no-op, so no guard is needed.
  onConnect(() => {
    void import('../client/interop-client.ts');
  });

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
