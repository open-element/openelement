import { definePage } from '@openelement/router';
import { defineIslandConfig } from '@openelement/router';
import { resetPasswordAction, resetPasswordPageProps } from '../route-logic/reset-password.ts';

// The compiler admits page functions declared in their route module.
export const openElement = defineIslandConfig({
  tag: 'reset-password-page',
  root: 'shadow',
  properties: {
    errorText: { default: '' },
  },
});

export function ResetPasswordPage(props: { errorText: string }) {
  return (
    <main>
      <h1>Reset password</h1>
      <p id='error'>{props.errorText}</p>
      <form method='post'>
        <label>
          New password{' '}
          <input
            type='password'
            name='password'
            autocomplete='new-password'
            minlength={8}
            required
          />
        </label>
        <button type='submit'>Set password</button>
      </form>
    </main>
  );
}

export const action = resetPasswordAction;

export default definePage(ResetPasswordPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'Reset password' },
  props: resetPasswordPageProps,
});
