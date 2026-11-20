/**
 * Public home page — prerendered at build time (default static intent).
 *
 * The page component is declared IN THIS MODULE (D-M11, 2026-11-20): the server
 * function page lane records `pageComponentName` only when `definePage(…)`'s
 * first argument is a plain identifier naming an exported component function
 * this route module declares itself
 * (`packages/compiler/src/internal/compiler/semantic-core/module-analysis.ts`,
 * the `serverComponents.has(…)` admission; `www/app/routes/404.tsx` and
 * `www/app/routes/index/index.tsx` are the production precedents). An imported
 * component is not admitted, so the retired `components/page-home.tsx` class
 * moved here with the class→function migration. The page has no property rows:
 * it renders no data the route could project, so the router's default static
 * intent stands.
 */
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

export default definePage(HomePage, {
  head: { title: 'Reference starter — OpenElement × Supabase × Cloudflare' },
});
