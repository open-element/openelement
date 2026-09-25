/**
 * /stream-lit-proof page element (#1451 T2) — Lit survival inside a streamed
 * deferred-Region page (compiled).
 *
 * Layout pins the T2 placement contract:
 * - the slow `message` field owns the deferred text Part in #delayed, so the
 *   backfill frame replaces ONLY the nodes between #delayed's anchors;
 * - <stream-lit-pill> and its server-born light-DOM slot child live in the
 *   streamed shell next to that Part. The stream frame policy deliberately
 *   excludes foreign custom-element tags from backfilled ranges (build
 *   manifest, deferred executor, and browser installer all fail closed), so
 *   the T0 host with slot-first children must survive the backfill untouched:
 *   exactly one instance, still upgraded, slot content and live count intact.
 * - <stream-lit-probe> is the island whose activation loads the Lit module.
 */
import { element, OpenElement, property } from '@openelement/element';

@element('stream-lit-proof-page', { root: 'shadow-open' })
export default class StreamLitProofPage extends OpenElement {
  @property({ reflect: false, attribute: false })
  message = '';

  render() {
    return (
      <main>
        <h1>Stream lit proof</h1>
        <p id='shell-marker'>shell flush precedes the late frame</p>
        <section id='late-zone'>
          <p id='delayed'>{this.message}</p>
          <stream-lit-pill id='pill'>
            <span id='pill-slot-label' slot='label'>Server-born pill label</span>
          </stream-lit-pill>
        </section>
        <stream-lit-probe id='lit-loader'></stream-lit-probe>
      </main>
    );
  }
}
