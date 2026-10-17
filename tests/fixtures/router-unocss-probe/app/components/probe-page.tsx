/**
 * The light-root page: its class tokens live in DOCUMENT DOM, so they are the
 * document sheet's business. The compiler collects them as light-root
 * candidates and the UnoCSS adapter compiles them into the document sheet —
 * the same channel a consumer's own markup classes take.
 *
 * `host-panel` is an authored rule that stays CSS (a host box plus a
 * pseudo-element the utility set does not reach); the rest is utilities.
 */
import { element, OpenElement } from '@openelement/element';
import pageStyles from './probe-page.css';

@element('probe-unocss-page', { root: 'light' })
export default class ProbeUnocssPage extends OpenElement {
  static override styles = [pageStyles];

  render() {
    return (
      <main class="host-panel mx-auto max-w-[42rem] px-6 py-10 font-sans text-foreground">
        <h1 class="m-0 text-xl font-semibold tracking-tight">openElement × UnoCSS</h1>
        <p class="mt-3 text-sm leading-relaxed text-muted">
          The document sheet is compiled by the application&rsquo;s own UnoCSS configuration from
          this page&rsquo;s admitted class tokens and the declared token source.
        </p>
        <probe-unocss-card></probe-unocss-card>
      </main>
    );
  }
}
