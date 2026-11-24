/**
 * /subscribe page element — valibot validation recipe (compiled, v0.44): same
 * contract as the zod recipe, different library, to prove the loop is
 * library-agnostic.
 *
 * GENERATED lane (F16: class → function).
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'subscribe-page',
  root: 'shadow',
  properties: {
    email: { attribute: false, default: '' },
    welcomeText: { attribute: false, default: 'welcome=' },
    hasError: { attribute: false, default: 0 },
  },
});

interface SubscribePageProps {
  email: string;
  welcomeText: string;
  hasError: number;
}

export default function SubscribePage(props: SubscribePageProps) {
  return (
    <main>
      <h1>subscribe with valibot</h1>
      <form method="post" data-open-enhance>
        <input id="email" name="email" type="text" value={props.email} />
        <button id="subscribe" type="submit">
          Subscribe
        </button>
      </form>
      {props.hasError > 0 ? (
        <p id="error">a valid email is required</p>
      ) : (
        <span data-error="none"></span>
      )}
      <p id="welcome">{props.welcomeText}</p>
    </main>
  );
}
