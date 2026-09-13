/** Home page element — public, prerendered at build time (default static intent). */
import { element, OpenElement } from '@openelement/element';

@element('index-page', { root: 'shadow-open' })
export default class HomePage extends OpenElement {
  render() {
    return (
      <main>
        <h1>Reference starter</h1>
        <p>
          OpenElement app shell on the Nitro cloudflare_module output, Supabase-backed.
        </p>
        <ul>
          <li>
            <a href='/notes'>Protected notes (RLS)</a>
          </li>
          <li>
            <a href='/upload'>Storage upload (owner-scoped bucket)</a>
          </li>
          <li>
            <a href='/login'>Sign-in</a>
          </li>
          <li>
            <a href='/checkout'>One-time Stripe Checkout</a>
          </li>
        </ul>
      </main>
    );
  }
}
