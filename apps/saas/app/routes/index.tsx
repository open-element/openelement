/** The compiler admits page functions declared in their route module. */
import { definePage } from '@openelement/router';

export function HomePage() {
  return (
    <main>
      <h1>Reference starter</h1>
      <p>OpenElement app shell on the Nitro cloudflare_module output, Supabase-backed.</p>
      <ul>
        <li>
          <a href='/notes'>Protected notes (RLS)</a>
        </li>
        <li>
          <a href='/upload'>Attachments</a>
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

export default definePage(HomePage, {
  head: { title: 'Reference starter — OpenElement × Supabase × Cloudflare' },
});
