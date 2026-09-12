/**
 * /recover — request-time password-recovery route. The compiled page element
 * lives in app/components/page-recover.tsx; the loader/action logic lives in
 * app/route-logic/recover.ts so Deno tests import it without evaluating the
 * compiled class.
 */
import { definePage } from '@openelement/app';
import RecoverPage from '../components/page-recover.tsx';
import { createRecoverAction, recoverLoader, recoverPageProps } from '../route-logic/recover.ts';

export const loader = recoverLoader;
export const action = createRecoverAction();

export default definePage(RecoverPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'Recover password' },
  props: recoverPageProps,
});
