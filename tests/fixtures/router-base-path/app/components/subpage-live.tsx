/**
 * Non-root-base fixture — the streamed page's LIGHT component (S-C2/S-12).
 *
 * `message` is a deferred field (the route streams it), so the response is a
 * streamed document whose ORIGINAL head must already declare this sheet's
 * emitted asset — the head is flushed before the deferred frame resolves.
 */
import { element, OpenElement, property } from '@openelement/element';
import liveStyles from './subpage-live.css';

@element('subpage-live', { root: 'light' })
export default class SubpageLive extends OpenElement {
  @property({ reflect: false, attribute: false })
  message = '';

  static override styles = [liveStyles];

  render() {
    return (
      <main class='subpage-live'>
        <h1>streamed base path</h1>
        <p id='deferred'>{this.message}</p>
      </main>
    );
  }
}
