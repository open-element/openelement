/**
 * /checkout page element (v0.44 compiled). Request-time rendered; anonymous
 * GETs redirect to /login from the loader. The result banner branches are
 * fully static conditional Regions; the attempt id rides a property Part on
 * the hidden input (the form stays no-JS capable).
 */
import { element, OpenElement, property } from '@openelement/element';

@element('checkout-page', { root: 'shadow-open' })
export default class CheckoutPage extends OpenElement {
  @property({ reflect: false, attribute: false })
  actionErrorText = '';

  @property({ reflect: false, attribute: false })
  attemptId = '';

  @property({ reflect: false, attribute: false })
  resultSuccess = 0;

  @property({ reflect: false, attribute: false })
  resultCancelled = 0;

  @property({ reflect: false, attribute: false })
  orderRows: Array<{ id: string; line: string }> = [];

  render() {
    return (
      <main>
        <h1>One-time Checkout</h1>
        <p>Starter support — USD 5.00, one-time payment.</p>
        <form method='post' action='/checkout?/checkout'>
          <input type='hidden' name='attempt_id' value={this.attemptId} />
          <button type='submit'>Pay with Stripe</button>
        </form>
        {this.resultSuccess > 0
          ? (
            <p id='checkout-result'>
              Checkout returned. Payment status is confirmed by webhook only.
            </p>
          )
          : <span></span>}
        {this.resultCancelled > 0
          ? <p id='checkout-result'>Checkout was cancelled.</p>
          : <span></span>}
        <p id='action-error'>{this.actionErrorText}</p>
        <h2>Your orders</h2>
        <ul id='orders'>
          {this.orderRows.map((order) => <li key={order.id}>{order.line}</li>)}
        </ul>
      </main>
    );
  }
}
