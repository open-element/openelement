/**
 * /magic-link — request-time magic-link route. Thin wrapper: the compiled
 * page element lives in app/components/page-magic-link.tsx, the
 * loader/action logic in app/route-logic/magic-link.ts.
 */
import { definePage } from '@openelement/app';
import MagicLinkPage from '../components/page-magic-link.tsx';
import {
  createMagicLinkAction,
  magicLinkLoader,
  magicLinkPageProps,
} from '../route-logic/magic-link.ts';

export const loader = magicLinkLoader;
export const action = createMagicLinkAction();

export default definePage(MagicLinkPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'Magic Link' },
  props: magicLinkPageProps,
});
