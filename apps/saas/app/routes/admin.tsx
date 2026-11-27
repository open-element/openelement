import { definePage } from '@openelement/router';
import { defineIslandConfig } from '@openelement/router';
import {
  adminPageProps,
  createAdminLoader,
  createPaymentReplayAction,
  createReplayAction,
} from '../route-logic/admin.ts';

// The compiler admits page functions declared in their route module.
export const openElement = defineIslandConfig({
  tag: 'admin-page',
  root: 'shadow',
  properties: {
    paymentRows: { attribute: false, default: [] },
    attachmentRows: { attribute: false, default: [] },
    whoText: { default: '' },
    errorText: { default: '' },
    actionErrorText: { default: '' },
    noteCountText: { default: '' },
  },
});

export function AdminPage(props: {
  whoText: string;
  errorText: string;
  actionErrorText: string;
  noteCountText: string;
  attachmentRows: Array<{ id: string; line: string }>;
  paymentRows: Array<{ id: string; line: string }>;
}) {
  return (
    <main>
      <h1>Admin</h1>
      <p>{props.whoText}</p>
      <p id='error'>{props.errorText}</p>
      <p id='action-error'>{props.actionErrorText}</p>
      <p id='note-count'>{props.noteCountText}</p>
      <h2>Attachment scan dead letters</h2>
      <ul id='attachment-dead-letters'>
        {props.attachmentRows.map((item) => (
          <li key={item.id}>{item.line}</li>
        ))}
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
        {props.paymentRows.map((item) => (
          <li key={item.id}>{item.line}</li>
        ))}
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
