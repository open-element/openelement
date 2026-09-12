/** /reset-password — request-time route (thin wrapper around the compiled page + route logic). */
import { definePage } from '@openelement/app';
import ResetPasswordPage from '../components/page-reset-password.tsx';
import { resetPasswordAction, resetPasswordPageProps } from '../route-logic/reset-password.ts';

export const action = resetPasswordAction;

export default definePage(ResetPasswordPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'Reset password' },
  props: resetPasswordPageProps,
});
