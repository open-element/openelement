/**
 * /admin page element (v0.44 compiled). Request-time rendered; the props
 * projector lives in app/route-logic/admin.ts. Replay requests post the id
 * shown in each row through the section-level forms (grammar v1 list Regions
 * carry no per-row forms).
 */
import { element, OpenElement, property } from '@openelement/element';

@element('admin-page', { root: 'shadow-open' })
export default class AdminPage extends OpenElement {
  @property({ reflect: false, attribute: false })
  whoText = '';

  @property({ reflect: false, attribute: false })
  errorText = '';

  @property({ reflect: false, attribute: false })
  actionErrorText = '';

  @property({ reflect: false, attribute: false })
  noteCountText = '';

  @property({ reflect: false, attribute: false })
  attachmentRows: Array<{ id: string; line: string }> = [];

  @property({ reflect: false, attribute: false })
  paymentRows: Array<{ id: string; line: string }> = [];

  render() {
    return (
      <main>
        <h1>Admin</h1>
        <p>{this.whoText}</p>
        <p id='error'>{this.errorText}</p>
        <p id='action-error'>{this.actionErrorText}</p>
        <p id='note-count'>{this.noteCountText}</p>
        <h2>Attachment scan dead letters</h2>
        <ul id='attachment-dead-letters'>
          {this.attachmentRows.map((item) => <li key={item.id}>{item.line}</li>)}
        </ul>
        <form method='post' action='/admin?/replay'>
          <p>
            <label>
              Dead-letter id <input type='text' name='id' required />
            </label>
          </p>
          <button type='submit'>Request replay</button>
        </form>
        <h2>Payment event dead letters</h2>
        <ul id='payment-dead-letters'>
          {this.paymentRows.map((item) => <li key={item.id}>{item.line}</li>)}
        </ul>
        <form method='post' action='/admin?/replayPayment'>
          <p>
            <label>
              Payment event id <input type='text' name='event_id' required />
            </label>
          </p>
          <button type='submit'>Request payment replay</button>
        </form>
      </main>
    );
  }
}
