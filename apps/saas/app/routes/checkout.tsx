import { definePage } from '@openelement/router';
import { defineIslandConfig } from '@openelement/router';
import {
  checkoutPageProps,
  createCheckoutAction,
  createCheckoutLoader,
} from '../route-logic/checkout.ts';

// The compiler admits page functions declared in their route module.
export const openElement = defineIslandConfig({
  tag: 'checkout-page',
  root: 'shadow',
  properties: {
    orderRows: { attribute: false, default: [] },
    actionErrorText: { default: '' },
    attemptId: { default: '' },
    resultSuccess: { default: 0 },
    resultCancelled: { default: 0 },
  },
});

export function CheckoutPage(props: {
  actionErrorText: string;
  attemptId: string;
  resultSuccess: number;
  resultCancelled: number;
  orderRows: Array<{ id: string; line: string }>;
}) {
  return (
    <main>
      <h1>One-time Checkout</h1>
      <p>Starter support — USD 5.00, one-time payment.</p>
      <form method='post' action='/checkout?/checkout'>
        <input type='hidden' name='attempt_id' value={props.attemptId} />
        <button type='submit'>Pay with Stripe</button>
      </form>
      {props.resultSuccess > 0 ? (
        <p id='checkout-result'>Checkout returned. Payment status is confirmed by webhook only.</p>
      ) : (
        <span></span>
      )}
      {props.resultCancelled > 0 ? (
        <p id='checkout-result'>Checkout was cancelled.</p>
      ) : (
        <span></span>
      )}
      <p id='action-error'>{props.actionErrorText}</p>
      <h2>Your orders</h2>
      <ul id='orders'>
        {props.orderRows.map((order) => (
          <li key={order.id}>{order.line}</li>
        ))}
      </ul>
    </main>
  );
}

export const loader = createCheckoutLoader();
export const actions = { checkout: createCheckoutAction() };

export default definePage(CheckoutPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'Checkout — reference starter' },
  props: checkoutPageProps,
});
