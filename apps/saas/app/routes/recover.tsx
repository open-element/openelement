/**
 * /recover — request-time password-recovery route. The compiled page element
 * lives in app/components/page-recover.tsx; the loader/action logic lives in
 * app/route-logic/recover.ts so Deno tests import it without evaluating the
 * compiled class.
 */
import { definePage } from '@openelement/router';
import { defineIslandConfig } from '@openelement/router';
import { createRecoverAction, recoverLoader, recoverPageProps } from '../route-logic/recover.ts';

/**
 * The page component is declared IN THIS MODULE (execution-plan §19.9): the
 * server function page lane records `pageComponentName` only for an exported
 * component function the route module declares itself, so an imported class
 * could not be admitted. Was `app/components/page-recover.tsx`.
 */

export const openElement = defineIslandConfig({
  tag: 'recover-page',
  root: 'shadow',
  properties: {
    errorText: { default: '' },
    sent: { default: 0 },
  },
});

export function RecoverPage(props: { errorText: string; sent: number }) {
  return (
    <main>
      <h1>Recover password</h1>
      <p id='error'>{props.errorText}</p>
      {props.sent > 0 ? (
        <p id='message'>If the account exists, a recovery email has been sent.</p>
      ) : (
        <span></span>
      )}
      <form method='post'>
        <label>
          Email <input type='email' name='email' autocomplete='email' spellcheck='false' required />
        </label>
        <button type='submit'>Send recovery email</button>
      </form>
    </main>
  );
}

export const loader = recoverLoader;
export const action = createRecoverAction();

export default definePage(RecoverPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'Recover password' },
  props: recoverPageProps,
});
