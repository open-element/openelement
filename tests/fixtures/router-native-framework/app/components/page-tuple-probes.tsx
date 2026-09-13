/**
 * /tuple-probes page element (#1339 §5) — effective submission tuple probes
 * (compiled). Every form is enhanced-marked; the contract decides per tuple:
 *
 * - #urlenc-form: POST with the default (urlencoded) enctype — the enhanced
 *   path must send the exact native urlencoded bytes and Content-Type;
 * - #multipart-form / #mo-form: multipart via the form attribute and via the
 *   submitter's formenctype override — FormData passthrough, never a hand-set
 *   boundary;
 * - #textplain-form: text/plain is never intercepted (explicit native
 *   fallback before preventDefault);
 * - #post-get-form / #get-post-form: formmethod overrides in both directions
 *   (POST form + GET submitter navigates natively; GET form + POST submitter
 *   enhances as POST);
 * - #dialog-form: method='dialog' closes the dialog natively, never fetch()ed;
 * - #target-form: submitter formtarget='_blank' keeps the new-tab behavior;
 * - #nl-form: a real textarea — multi-line values serialize byte-identically
 *   on both paths (lone CR/LF normalize to CRLF before percent-encoding).
 */
import { element, OpenElement } from '@openelement/element';

@element('tuple-probes-page', { root: 'shadow-open' })
export default class TupleProbesPage extends OpenElement {
  render() {
    return (
      <main>
        <h1>tuple probes</h1>
        <form id='urlenc-form' method='post' action='/tuple-probes' data-open-enhance>
          <input id='urlenc-title' name='title' type='text' value='hello world' />
          <input id='urlenc-tag' name='tag' type='text' value='a&b' />
          <button id='urlenc-submit' type='submit' name='intent' value='urlenc'>Urlencoded</button>
        </form>
        <form
          id='multipart-form'
          method='post'
          enctype='multipart/form-data'
          action='/tuple-probes'
          data-open-enhance
        >
          <input id='multipart-title' name='title' type='text' value='multi part' />
          <button id='multipart-submit' type='submit' name='intent' value='multipart'>
            Multipart
          </button>
        </form>
        <form id='mo-form' method='post' action='/tuple-probes' data-open-enhance>
          <input id='mo-title' name='title' type='text' value='via override' />
          <button
            id='mo-submit'
            type='submit'
            name='intent'
            value='mo'
            formenctype='multipart/form-data'
          >
            Multipart override
          </button>
        </form>
        <form
          id='textplain-form'
          method='post'
          enctype='text/plain'
          action='/tuple-probes'
          data-open-enhance
        >
          <input id='tp-title' name='title' type='text' value='plain text' />
          <button id='tp-submit' type='submit' name='intent' value='tp'>Text plain</button>
        </form>
        <form id='post-get-form' method='post' action='/tuple-probes' data-open-enhance>
          <input id='pg-q' name='q' type='text' value='via-get' />
          <button id='pg-submit' type='submit' formmethod='get'>Submitter GET</button>
        </form>
        <form id='get-post-form' method='get' action='/tuple-probes' data-open-enhance>
          <input id='gp-q' name='q' type='text' value='via-post' />
          <button id='gp-submit' type='submit' name='intent' value='gp' formmethod='post'>
            Submitter POST
          </button>
        </form>
        <dialog id='probe-dialog'>
          <form id='dialog-form' method='dialog' data-open-enhance>
            <input id='dlg-field' name='dlg' type='text' value='d' />
            <button id='dialog-submit' type='submit'>Close dialog</button>
          </form>
        </dialog>
        <form id='target-form' method='post' action='/tuple-probes' data-open-enhance>
          <input id='to-field' name='to' type='text' value='t' />
          <button id='to-submit' type='submit' formtarget='_blank'>New tab via formtarget</button>
        </form>
        {
          /* #1339 wire parity: a real textarea whose multi-line value must
             serialize byte-identically on both paths — the platform urlencoded
             serializer converts lone CR/LF to CRLF (%0D%0A on the wire). */
        }
        <form id='nl-form' method='post' action='/tuple-probes' data-open-enhance>
          <textarea id='nl-note' name='note'></textarea>
          <button id='nl-submit' type='submit' name='intent' value='nl'>Newlines</button>
        </form>
      </main>
    );
  }
}
