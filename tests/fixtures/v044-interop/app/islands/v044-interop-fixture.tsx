/** @jsxImportSource @openelement/element */
import { defineIsland, defineIslandConfig } from '@openelement/router';

export const tagName = 'v044-interop-fixture';
export const openElement = defineIslandConfig({ hydrate: 'load', ssr: true, dsd: true });

if (typeof window !== 'undefined') {
  const findTag = (root: Document | ShadowRoot, tag: string): HTMLElement | null => {
    const direct = root.querySelector(tag);
    if (direct) return direct as HTMLElement;
    for (const element of root.querySelectorAll('*')) {
      const shadow = (element as HTMLElement).shadowRoot;
      if (!shadow) continue;
      const found = findTag(shadow, tag);
      if (found) return found;
    }
    return null;
  };
  const loadInteropClient = (): void => {
    const fixture = findTag(document, tagName);
    if (fixture?.shadowRoot) {
      void import('../client/v044-interop-client.ts');
      return;
    }
    requestAnimationFrame(loadInteropClient);
  };
  loadInteropClient();
}

export default defineIsland(tagName, {
  render() {
    return (
      <main id='v044-interop-main'>
        <h1>OpenElement v0.44 interoperability corpus</h1>
        <v044-interop-child-host id='children'>
          <v044-native-probe id='native-child' value='native-child'>Native child</v044-native-probe>
          <v044-lit-probe id='lit-child' value='lit-child'>Lit child</v044-lit-probe>
          <v044-fast-probe id='fast-child' value='fast-child'>FAST child</v044-fast-probe>
          <v044-stencil-probe id='stencil-child' disabled='true'>Stencil child</v044-stencil-probe>
        </v044-interop-child-host>
        <section id='application-dependencies'>
          <h2>Application dependencies</h2>
          <v044-native-probe id='native-dependency' value='native-dependency'>
            Native dependency
          </v044-native-probe>
          <v044-lit-probe id='lit-dependency' value='lit-dependency'>Lit dependency</v044-lit-probe>
          <v044-fast-probe id='fast-dependency' value='fast-dependency'>
            FAST dependency
          </v044-fast-probe>
          <v044-stencil-probe id='stencil-dependency' disabled='true'>
            Stencil dependency
          </v044-stencil-probe>
        </section>
        <section id='fresh-probes' aria-hidden='true'></section>
      </main>
    );
  },
}, openElement);
