/**
 * /checkout — one-time Stripe Checkout route (thin wrapper). The compiled
 * page element lives in app/components/page-checkout.tsx, the loader/action
 * logic in app/route-logic/checkout.ts.
 */
import { definePage } from '@openelement/app';
import CheckoutPage from '../components/page-checkout.tsx';
import {
  checkoutPageProps,
  createCheckoutAction,
  createCheckoutLoader,
} from '../route-logic/checkout.ts';

export const loader = createCheckoutLoader();
export const actions = { checkout: createCheckoutAction() };

export default definePage(CheckoutPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'Checkout — reference starter' },
  props: checkoutPageProps,
});
