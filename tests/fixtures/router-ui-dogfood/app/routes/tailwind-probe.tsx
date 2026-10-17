/** Static route for the shadow-native Tailwind probe (alpha15 S lane). */
import { definePage } from '@openelement/router';
import TailwindProbePage from '../components/page-tailwind-probe.tsx';

export default definePage(TailwindProbePage, {
  head: { title: 'ui dogfood fixture — shadow-native tailwind probe' },
});
