/** Public home page — prerendered at build time (default static intent). */
import { definePage } from '@openelement/app';
import HomePage from '../components/page-home.tsx';

export default definePage(HomePage, {
  head: { title: 'Reference starter — OpenElement × Supabase × Cloudflare' },
});
