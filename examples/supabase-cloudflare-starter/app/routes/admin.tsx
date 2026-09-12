/**
 * /admin — request-time admin route (thin wrapper). The compiled page element
 * lives in app/components/page-admin.tsx, the loader/action logic in
 * app/route-logic/admin.ts.
 */
import { definePage } from '@openelement/app';
import AdminPage from '../components/page-admin.tsx';
import {
  adminPageProps,
  createAdminLoader,
  createPaymentReplayAction,
  createReplayAction,
} from '../route-logic/admin.ts';

export const loader = createAdminLoader();
export const actions = {
  replay: createReplayAction(),
  replayPayment: createPaymentReplayAction(),
};

export default definePage(AdminPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'Admin' },
  props: adminPageProps,
});
