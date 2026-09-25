/**
 * stream-lit-probe — wiring island for the /stream-lit-proof route (#1451 T2).
 *
 * The island itself proves nothing about Lit; it exists so the generated
 * client entry loads a module that registers <stream-lit-pill> before (or as)
 * the streamed shell upgrades. It follows the third-party fixture's client
 * wiring: activation hooks dynamically import a client-only module, so the
 * Lit registration runs in the browser only. Its status paragraph is
 * CLIENT-rendered at island activation — a streamed deferred shell emits
 * islands as opaque empty hosts (the deferred executor admits no nested
 * renderer), so this paragraph is evidence that island hydration ran, never
 * evidence about shell survival; the shell-survival marker is the page's
 * #shell-marker, which the server-born shell carries.
 */
import { defineIslandConfig } from '@openelement/router';
import { element, OpenElement } from '@openelement/element';

export const openElement = defineIslandConfig({ hydrate: 'load', ssr: true, dsd: true });

@element('stream-lit-probe', { root: 'shadow-open' })
export default class StreamLitProbe extends OpenElement {
  override onDsdHydrated(): void {
    this.loadLitPillModule();
  }

  override onCsrRendered(): void {
    this.loadLitPillModule();
  }

  /** Register the Lit pill module exactly once per document, in the browser. */
  private loadLitPillModule(): void {
    if (typeof window === 'undefined') return;
    void import('../client/stream-lit-client.ts');
  }

  render() {
    return <p id='lit-loader-status'>lit pill loader armed</p>;
  }
}
